// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract EnergyEscrow is Ownable {
    struct Recipient {
        //This is to allow Allow multiple completions from the same assistant
        bytes32 uuid;
        address recipientAddress;
        bool claimed;
        bool claimable;
    }

    struct Deposit {
        address depositor;
        uint256 amount;
        uint256 claimableAmount;
        uint256 refundableAmount;
        Recipient[] recipients;
        bool allowRefund;
        uint32 assistantCount;
        bool isOpenEnded;
    }
    IERC20 public ENRG;
    mapping(bytes32 => Deposit) public deposits;
    mapping(bytes32 => mapping(bytes32 => uint256)) private recipientIndex;


    constructor(IERC20 _ENRG) Ownable(msg.sender) {
        ENRG = _ENRG;
    }

    /**
     * Called by owners creating tasks
     * @param uuid deposit uuid
     * @param amount amount of ENRG being deposited
     */
    function deposit(bytes32 uuid, uint256 amount) external {
        Deposit storage uniqueDeposit = deposits[uuid];
        uint256 allowance = ENRG.allowance(msg.sender, address(this));
        require(
            allowance >= amount,
            "EnergyEscrow::deposit: please approve tokens before depositing"
        );
        ENRG.transferFrom(msg.sender, address(this), amount);

        // aggregate deposits of the same uuid
        uniqueDeposit.amount += amount;

        // We allow refunds by default
        uniqueDeposit.allowRefund = true;

        // By default, we set the isOpenEnded flag to false
        uniqueDeposit.isOpenEnded = false;

        if (uniqueDeposit.depositor == address(0)) {
            uniqueDeposit.depositor = msg.sender;
        }
    }

    /**
     * To allow the contract owner to set if a certain deposit is refundable
     * @param uuid deposit uuid
     * @param allow true/false
     */
    function setAllowRefund(bytes32 uuid, bool allow) external onlyOwner {
        Deposit storage uniqueDeposit = deposits[uuid];
        uniqueDeposit.allowRefund = allow;
    }

    function setIsOpenEnded(bytes32 uuid, bool isOpenEnded) external onlyOwner {
        Deposit storage uniqueDeposit = deposits[uuid];
        uniqueDeposit.isOpenEnded = isOpenEnded;
    }

    function setAmounts(
        bytes32 uuid,
        uint256 claimableAmount,
        uint256 refundableAmount,
        uint32 assistantCount
    ) external onlyOwner {
        Deposit storage uniqueDeposit = deposits[uuid];

        if (!uniqueDeposit.isOpenEnded) {
            if(uniqueDeposit.assistantCount == 0 && assistantCount > 0) {
                if (assistantCount == 1) {
                    require(
                        uniqueDeposit.amount >= claimableAmount + refundableAmount,
                        "EnergyEscrow::setAmounts: total amount is not equal to the remaining balance"
                    );
                }
            } else {
                //If there's already changes
                if (uniqueDeposit.assistantCount > assistantCount) {
                    // Refund depositor if assistant count is reduced
                    _handleRefundOnAssistantCountReduction(uniqueDeposit, assistantCount);
                } else if (uniqueDeposit.assistantCount == assistantCount) {
                    // Handle compensation adjustment if assistant count remains the same
                    _handleCompensationAdjustment(uniqueDeposit,claimableAmount);
                }
            }

            uniqueDeposit.assistantCount = assistantCount;
        }
        uniqueDeposit.claimableAmount = claimableAmount;
        uniqueDeposit.refundableAmount = refundableAmount;
    }

    /**
     * Adds a new recipient to a specific deposit.
     * This function is used to associate an assistant (recipient) with a particular task represented by a deposit.
     * It updates the deposit with the recipient's details, setting the initial status of their task completion to false.
     *
     * @param uuid deposit uuid
     * @param recipient assistant address
     */

    function addRecipient(
        bytes32 uuid,
        address recipient,
        bytes32 recipientUuid
    ) external onlyOwner {
        Deposit storage uniqueDeposit = deposits[uuid];

        if(!uniqueDeposit.isOpenEnded){
            require(
                uniqueDeposit.depositor != address(0),
                "EnergyEscrow::addRecipient: invalid uuid"
            );
            require(
                uniqueDeposit.recipients.length < uniqueDeposit.assistantCount,
                "EnergyEscrow::addRecipient: Recipients cannot exceed the assistant count"
            );
        }
        else {
            require(uniqueDeposit.amount > uniqueDeposit.claimableAmount, "EnergyEscrow::addRecipient: There's insufficient deposit balance to cater another recipient addition");
                        require(
                uniqueDeposit.depositor != address(0),
                "EnergyEscrow::addRecipient: invalid uuid"
            );
        }


        Recipient memory newRecipient = Recipient({
            claimed: false,
            claimable: false,
            recipientAddress: recipient,
            uuid: recipientUuid
        });
        uniqueDeposit.recipients.push(newRecipient);
        recipientIndex[uuid][recipientUuid] = uniqueDeposit.recipients.length - 1;
    }

    /**
     * Used after assistant accomplishes the task
     * @param uuid deposit uuid
     * @param recUuid recipient uuid
     */
    function setClaimable(bytes32 uuid, bytes32 recUuid) external onlyOwner {
        Deposit storage uniqueDeposit = deposits[uuid];
        uint256 index = recipientIndex[uuid][recUuid];
        require(index<uniqueDeposit.recipients.length,"EnergyEscrow::setClaimable: Recipient not found");
        Recipient storage recipient = uniqueDeposit.recipients[index];
        recipient.claimable = true;
    }

    /**
     * Used by assistants when claiming
     * @param uuid deposit uuid
     * @param recipientUuid recipient uuid
     */
    function claim(bytes32 uuid, bytes32 recipientUuid) external {
        Deposit storage uniqueDeposit = deposits[uuid];
        require(
            uniqueDeposit.recipients.length > 0,
            "EnergyEscrow::claim: no recipients"
        );
        uint256 individualClaimAmount = uniqueDeposit.claimableAmount;
        uint256 index = recipientIndex[uuid][recipientUuid];
        require(index < uniqueDeposit.recipients.length, "EnergyEscrow::removeRecipient: recipient not found");

        Recipient storage recipient = uniqueDeposit.recipients[index];
        require(msg.sender == recipient.recipientAddress, "EnergyEscrow::claim: Recipient Address is not the same as sender address");
        require(recipient.claimable, "EnergyEscrow::claim: The recipient deposit state is not yet claimable");
        require(!recipient.claimed,"EnergyEscrow::claim: The recipient deposit is already claimed");
        uniqueDeposit.amount -= individualClaimAmount;
        if (uniqueDeposit.assistantCount == 1) {
            uniqueDeposit.claimableAmount = 0;
        } else {
            uniqueDeposit.refundableAmount -= individualClaimAmount;
        }

        recipient.claimed = true;
        ENRG.transfer(msg.sender, individualClaimAmount);
    }

    /**
     * Specifically for refunds (setting tasks to draft/deleting tasks) / Can also be used by admins
     * @param uuid deposit uuid
     */
    function refund(bytes32 uuid) external {
        Deposit storage uniqueDeposit = deposits[uuid];
        require(
            (msg.sender == uniqueDeposit.depositor &&
                uniqueDeposit.allowRefund == true) || msg.sender == owner(),
            "EnergyEscrow::refund: conditions for refund not met"
        );
        require(
            uniqueDeposit.allowRefund,
            "EnergyEscrow::refund: The deposit should be refundable"
        );

        //For multiplicity tasks
        if (uniqueDeposit.assistantCount > 1) {
            require(
                uniqueDeposit.recipients.length == 0,
                "EnergyEscrow::refund: There should be no recipients to be eligible for a refund"
            );

            uint256 refundable = uniqueDeposit.amount;
            require(refundable > 0, "EnergyEscrow::refund: nothing to refund");
            uniqueDeposit.refundableAmount = 0;
            uniqueDeposit.claimableAmount = 0;
            uniqueDeposit.amount -= refundable;
            ENRG.transfer(uniqueDeposit.depositor, refundable);
        }
        //For standard tasks
        else {
            require(
                uniqueDeposit.recipients.length == 0,
                "EnergyEscrow::refund: There should be no recipients to be eligible for a refund"
            );
            require(
                uniqueDeposit.refundableAmount > 0,
                "EnergyEscrow::refund: Cannot refund as the task was previously accepted by an assistant"
            );
            uint256 refundable = uniqueDeposit.amount;
            require(refundable > 0, "EnergyEscrow::refund: nothing to refund");
            uniqueDeposit.refundableAmount = 0;
            uniqueDeposit.amount -= refundable;
            ENRG.transfer(uniqueDeposit.depositor, refundable);
        }
    }

    /**
     * For EXTREME cases that the owner wants to be refunded, or the owner abuses the feature wherein they'll purposedly deny the reward of the assistant.
     * This disregards the setRefundable flag
     * @param uuid Deposit Uuid
     * @param recipientUuid Recipient Uuid
     * @param targetAddress Owner/Assistant Address
     */
    function forceRefund(
        bytes32 uuid,
        bytes32 recipientUuid,
        address targetAddress
    ) external onlyOwner {
        Deposit storage uniqueDeposit = deposits[uuid];
        bool isRecipientMatch = false;
        uint256 index = recipientIndex[uuid][recipientUuid];
        require(index < uniqueDeposit.recipients.length, "EnergyEscrow::removeRecipient: recipient not found");

        Recipient storage recipient = uniqueDeposit.recipients[index];
        if(recipient.recipientAddress == targetAddress) {
            isRecipientMatch=true;
        }

        require(
            targetAddress == uniqueDeposit.depositor || isRecipientMatch,
            "EnergyEscrow::refund: Target address does not match depositor or any recipient"
        );

        //Owner force refund
        if (targetAddress == uniqueDeposit.depositor) {
            _ownerRefund(uniqueDeposit);
        }
        //Assistant force compensate
        else {
            _assistantRefund(uniqueDeposit, recipient);
        }
    }

    function removeRecipient(bytes32 uuid, bytes32 recUuid) external onlyOwner {
        Deposit storage uniqueDeposit = deposits[uuid];
        require(
            uniqueDeposit.depositor != address(0),
            "EnergyEscrow::removeRecipient: invalid uuid"
        );

        uint256 index = recipientIndex[uuid][recUuid];
        require(index < uniqueDeposit.recipients.length, "EnergyEscrow::removeRecipient: recipient not found");

        Recipient storage recipientToRemove = uniqueDeposit.recipients[index];
        require(
            !(recipientToRemove.claimable && !recipientToRemove.claimed),
            "EnergyEscrow::removeRecipient: Unable to remove recipient due to recipient state being set to claimable"
        );

        // Replace the recipient to remove with the last recipient in the array
        uniqueDeposit.recipients[index] = uniqueDeposit.recipients[uniqueDeposit.recipients.length - 1];

        // Update the index mapping for the moved recipient
        recipientIndex[uuid][uniqueDeposit.recipients[index].uuid] = index;

        // Remove the last element (now duplicated)
        uniqueDeposit.recipients.pop();

        // Remove the index from the mapping
        delete recipientIndex[uuid][recUuid];
    }


    /**
     * Deleting tasks
     * @param uuid deposit uuid
     */
    function deleteDeposit(bytes32 uuid) external onlyOwner {
        Deposit storage uniqueDeposit = deposits[uuid];
        require(
            uniqueDeposit.amount == 0,
            "There's still an amount left in the deposit"
        );
        delete deposits[uuid];
    }

    /**
     * Used in cases of owner wants to change their address. Maybe in the future we'll be able to support this. For ex. Owner address has been hacked.
     * @param uuid deposit uuid
     */
    function setDepositor(bytes32 uuid, address newAddress) external onlyOwner {
        Deposit storage uniqueDeposit = deposits[uuid];
        uniqueDeposit.depositor = newAddress;
    }

    //Implement assistant new address implementation if there's a need.

    /**
     * View deposit
     * @param uuid deposit uuid
     * @return depositor depositor address
     * @return amount amount of ENRG deposited
     * @return claimableAmount claimable amount
     * @return refundableAmount refundable amount
     * @return allowRefund If the deposit is refundable
     * @return recipientCount number of recipients so far
     * @return assistantCount number of maximum assistants for the task
     */
    function viewDeposit(
        bytes32 uuid
    )
        external
        view
        returns (
            address depositor,
            uint256 amount,
            uint256 claimableAmount,
            uint256 refundableAmount,
            bool allowRefund,
            uint256 recipientCount,
            uint256 assistantCount,
            bool isOpenEnded
        )
    {
        Deposit storage uniqueDeposit = deposits[uuid];
        return (
            uniqueDeposit.depositor,
            uniqueDeposit.amount,
            uniqueDeposit.claimableAmount,
            uniqueDeposit.refundableAmount,
            uniqueDeposit.allowRefund,
            uniqueDeposit.recipients.length,
            uniqueDeposit.assistantCount,
            uniqueDeposit.isOpenEnded
        );
    }

    /**
     * View deposit recipient details
     * @param uuid deposit uuid
     * @param recUuid recipient uuid
     * @return recipientAddress recipient address
     * @return claimable is deposit claimable
     * @return claimed is deposit claimed
     */
    function viewDepositRecipient(
        bytes32 uuid,
        bytes32 recUuid
    )
        external
        view
        returns (address recipientAddress, bool claimable, bool claimed)
    {
        Deposit storage uniqueDeposit = deposits[uuid];
        uint256 index = recipientIndex[uuid][recUuid];
        require(index < uniqueDeposit.recipients.length, "EnergyEscrow::removeRecipient: recipient not found");
        return (
                    uniqueDeposit.recipients[index].recipientAddress,
                    uniqueDeposit.recipients[index].claimable,
                    uniqueDeposit.recipients[index].claimed
        );
    }

        /**
         * Checks if a specific deposit task has been completed by all assigned assistants.
         * This function iterates through the recipients of a deposit and counts how many of them
         * have marked their associated task as claimed. The task is considered completed if the
         * number of claimed tasks equals the assistant count for the deposit.
         *
         * @param uuid deposit uuid
         */
    function isDepositCompleted(bytes32 uuid) external view returns (bool) {
        Deposit storage uniqueDeposit = deposits[uuid];
        if (uniqueDeposit.recipients.length < 1) {
            return false;
        }
        uint256 claimedRecipients = 0;
        if (uniqueDeposit.isOpenEnded) {
            for (uint256 i = 0; i < uniqueDeposit.recipients.length; i++) {
                if (uniqueDeposit.recipients[i].claimed) {
                    claimedRecipients++;
                }
            }
            return claimedRecipients == uniqueDeposit.recipients.length && uniqueDeposit.amount == 0;
        } else {
            for (uint256 i = 0; i < uniqueDeposit.recipients.length; i++) {
                if (uniqueDeposit.recipients[i].claimed) {
                    claimedRecipients++;
                    if (claimedRecipients == uniqueDeposit.assistantCount) {
                        return true;
                    }
                }
            }
            return false;
        }
    }


    function _ownerRefund(Deposit storage uniqueDeposit) private {
        uint256 claimableAssistant = 0;

        // Process claimable but unclaimed deposits
        for (uint256 i = 0; i < uniqueDeposit.recipients.length; i++) {
            Recipient storage recipient = uniqueDeposit.recipients[i];
            if (recipient.claimable && !recipient.claimed) {
                ENRG.transfer(
                    recipient.recipientAddress,
                    uniqueDeposit.claimableAmount
                );
                recipient.claimed = true;
                claimableAssistant++;
            }
        }

        uint256 refundAmt;

        if(!uniqueDeposit.isOpenEnded) {
            if (uniqueDeposit.assistantCount > 1) {
                // Calculate refund amount for multi-task
                refundAmt = uniqueDeposit.claimableAmount * 
                            (uniqueDeposit.assistantCount - claimableAssistant);
            } else {
                // Standard task refund
                refundAmt = uniqueDeposit.amount;
            }
        } else {
            // Refund calculation for open-ended tasks
            refundAmt = uniqueDeposit.amount - 
                        (uniqueDeposit.claimableAmount * claimableAssistant);
        }

        // Refund the remaining amount to the depositor
        if (refundAmt > 0) {
            ENRG.transfer(uniqueDeposit.depositor, refundAmt);
        }

        // Reset deposit amounts
        uniqueDeposit.amount = 0;
        uniqueDeposit.claimableAmount = 0;
        uniqueDeposit.refundableAmount = 0;
    }

    function _assistantRefund(
        Deposit storage uniqueDeposit,
        Recipient memory recipient
    ) private {
        uint256 claimable;

        if (uniqueDeposit.assistantCount > 1) {
            // For multi-tasks, compensate the claimable amount per assistant
            claimable = uniqueDeposit.claimableAmount;
            uniqueDeposit.refundableAmount -= claimable;
        } else {
            // For standard tasks, compensate the whole amount
            claimable = uniqueDeposit.amount;
            uniqueDeposit.claimableAmount = 0;
            uniqueDeposit.refundableAmount = 0;
        }

        // Common checks and operations for both cases
        require(claimable > 0, "EnergyEscrow::refund: nothing to refund");
        uniqueDeposit.amount -= claimable;

        // Update recipient state
        recipient.claimable = true;
        recipient.claimed = true;

        // Transfer the claimable amount to the recipient
        ENRG.transfer(recipient.recipientAddress, claimable);
    }

    function _handleRefundOnAssistantCountReduction(Deposit storage dep, uint32 assistantCount) private {
        uint256 enrgToRefund = dep.claimableAmount * (dep.assistantCount - assistantCount);
        ENRG.transfer(dep.depositor, enrgToRefund);
        dep.amount -= enrgToRefund;
        dep.refundableAmount -= enrgToRefund;
    }

    function _handleCompensationAdjustment(Deposit storage dep, uint256 claimableAmount) private {
        if (claimableAmount > dep.claimableAmount) {
            uint256 enrgCompensation = claimableAmount - dep.claimableAmount;
            for (uint i = 0; i < dep.recipients.length; i++) {
                if (dep.recipients[i].claimed) {
                    ENRG.transfer(dep.recipients[i].recipientAddress, enrgCompensation);
                    dep.amount -= enrgCompensation;
                }
            }
        }
    }

}
