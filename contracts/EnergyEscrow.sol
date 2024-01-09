// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract EnergyEscrow is Ownable {
    mapping(address => bool) private _authorized;
    address[] private _authorizedList;

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
    }
    IERC20 public ENRG;
    mapping(bytes32 => Deposit) public deposits;

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

    /**
     * Manages the update of claimable and refundable amounts for a specific deposit.
     * This function allows the contract owner to adjust the claimable and refundable amounts,
     * as well as the assistant count associated with a deposit. It includes logic for handling
     * refunds when the assistant count is reduced and for distributing additional rewards when
     * the claimable amount is increased.
     *
     * @param uuid deposit uuid
     * @param claimableAmount claimable amount
     * @param refundableAmount refundable amount
     * @param assistantCount Updated assistant count
     */
    function setAmounts(
        bytes32 uuid,
        uint256 claimableAmount,
        uint256 refundableAmount,
        uint32 assistantCount
    ) external onlyOwner {
        Deposit storage uniqueDeposit = deposits[uuid];

        //If standard task, require checks
        if (assistantCount == 1) {
            require(
                uniqueDeposit.amount >= claimableAmount + refundableAmount,
                "EnergyEscrow::setAmounts: total amount is not equal to the remaining balance"
            );
        }

        //Check if setAmounts was already called the first time
        if (uniqueDeposit.assistantCount != 0) {
            //Refund depositor if assistant count was lessened
            if (uniqueDeposit.assistantCount > assistantCount) {
                uint256 enrgToRefund = uniqueDeposit.claimableAmount *
                    (uniqueDeposit.assistantCount - assistantCount);
                ENRG.transfer(uniqueDeposit.depositor, enrgToRefund);
                uniqueDeposit.amount -= enrgToRefund;
                uniqueDeposit.refundableAmount -= enrgToRefund;
            }

            //Multiplicity/Missions
            if (
                uniqueDeposit.assistantCount > 1 &&
                uniqueDeposit.assistantCount == assistantCount
            ) {
                //Check if assistant count is still the same and is multiplicity/mission && there's increase in ENRG reward
                if (claimableAmount > uniqueDeposit.claimableAmount) {
                    uint256 enrgCompensation = claimableAmount -
                        uniqueDeposit.claimableAmount;
                    //Automatically send ENRG to users who already completed the task
                    for (uint i = 0; i < uniqueDeposit.recipients.length; i++) {
                        if (uniqueDeposit.recipients[i].claimed) {
                            ENRG.transfer(
                                uniqueDeposit.recipients[i].recipientAddress,
                                enrgCompensation
                            );
                            uniqueDeposit.amount -= enrgCompensation;
                        }
                    }
                }
            }
        }

        uniqueDeposit.claimableAmount = claimableAmount;
        uniqueDeposit.refundableAmount = refundableAmount;
        uniqueDeposit.assistantCount = assistantCount;
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
        require(
            uniqueDeposit.depositor != address(0),
            "EnergyEscrow::addRecipient: invalid uuid"
        );
        require(
            uniqueDeposit.recipients.length < uniqueDeposit.assistantCount,
            "EnergyEscrow::addRecipient: Recipients cannot exceed the assistant count"
        );

        Recipient memory newRecipient = Recipient({
            claimed: false,
            claimable: false,
            recipientAddress: recipient,
            uuid: recipientUuid
        });
        uniqueDeposit.recipients.push(newRecipient);
    }

    /**
     * Used after assistant accomplishes the task
     * @param uuid deposit uuid
     * @param recUuid recipient uuid
     */
    function setClaimable(bytes32 uuid, bytes32 recUuid) external onlyOwner {
        Deposit storage uniqueDeposit = deposits[uuid];
        for (uint i = 0; i < uniqueDeposit.recipients.length; i++) {
            if (uniqueDeposit.recipients[i].uuid == recUuid) {
                uniqueDeposit.recipients[i].claimable = true;
                break;
            }
        }
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
        bool isClaimed = false;
        for (
            uint i = 0;
            i < uniqueDeposit.recipients.length && !isClaimed;
            i++
        ) {
            Recipient storage recipient = uniqueDeposit.recipients[i];
            if (
                msg.sender == recipient.recipientAddress &&
                recipientUuid == recipient.uuid &&
                recipient.claimable &&
                !recipient.claimed
            ) {
                require(
                    individualClaimAmount > 0,
                    "EnergyEscrow::claim: nothing to claim"
                );
                require(
                    recipient.claimable,
                    "EnergyEscrow::claim: Reward should be claimable"
                );
                require(
                    !recipient.claimed,
                    "EnergyEscrow::claim: Reward is already claimed"
                );
                uniqueDeposit.amount -= individualClaimAmount;
                if (uniqueDeposit.assistantCount == 1) {
                    uniqueDeposit.claimableAmount = 0;
                } else {
                    uniqueDeposit.refundableAmount -= individualClaimAmount;
                }

                recipient.claimed = true;
                ENRG.transfer(msg.sender, individualClaimAmount);
                isClaimed = true;
            }
        }
        require(isClaimed, "EnergyEscrow::claim: Not eligible for claim");
    }

    /**
     * Specifically for refunds (setting tasks to draft/deleting tasks) / Can also be used by admins
     * @param uuid deposit uuid
     */
    function refund(bytes32 uuid) external  {
        Deposit storage uniqueDeposit = deposits[uuid];
        require(
            (msg.sender == uniqueDeposit.depositor &&
                uniqueDeposit.allowRefund == true) || msg.sender == owner(),
            "EnergyEscrow::refund: conditions for refund not met"
        );
        uint256 refundable = uniqueDeposit.refundableAmount > 0
            ? uniqueDeposit.refundableAmount
            : uniqueDeposit.amount;
        require(refundable > 0, "EnergyEscrow::refund: nothing to refund");
        uniqueDeposit.refundableAmount = 0;
        uniqueDeposit.amount -= refundable;
        ENRG.transfer(uniqueDeposit.depositor, refundable);
    }



    /**
     * For extreme cases that the owner wants to be refunded, or the owner abuses the feature wherein they'll purposedly deny the reward of the assistant.
     * @param uuid Deposit Uuid
     * @param recipientUuid Recipient Uuid
     * @param targetAddress Owner/Assistant Address
     */
    function forceRefund(bytes32 uuid, bytes32 recipientUuid, address targetAddress) external onlyOwner {
        Deposit storage uniqueDeposit = deposits[uuid];
        bool isRecipientMatch = false;
        address recipientAddress;

        for (uint i = 0; i < uniqueDeposit.recipients.length; i++) {
            Recipient storage recipient = uniqueDeposit.recipients[i];
            if (recipient.recipientAddress == targetAddress && recipient.uuid == recipientUuid) {
                isRecipientMatch = true;
                recipientAddress = recipient.recipientAddress;
                break;
            }
        }

        require(targetAddress == uniqueDeposit.depositor || isRecipientMatch,
            "EnergyEscrow::refund: Target address does not match depositor or any recipient"
        );

        //Owner force refund
        if(targetAddress == uniqueDeposit.depositor) {

            //If multi-task
            if(uniqueDeposit.assistantCount > 1) { 
                uint256 claimableAssistant = 0;

                //Automatic transfer when recipient's deposit is already claimable but was not claimed.
                for (uint256 i = 0; i < uniqueDeposit.recipients.length; i++) {
                    Recipient storage recipient = uniqueDeposit.recipients[i];
                        //If a deposit is claimable but assistant haven't even claimed yet, Automatic transfer. If claimed do nothing since it was already deducted
                        if(recipient.claimable && !recipient.claimed) {
                            ENRG.transfer(recipient.recipientAddress, uniqueDeposit.claimableAmount);
                            claimableAssistant++;
                        }
                }
                
                uint256 refundAmt = (uniqueDeposit.claimableAmount*(uniqueDeposit.assistantCount - claimableAssistant));

                ENRG.transfer(uniqueDeposit.depositor, refundAmt);
                uniqueDeposit.amount = 0;
                uniqueDeposit.claimableAmount = 0;
                uniqueDeposit.refundableAmount = 0;
            }

            //Standard tasks
            else {
                uint256 refundable = uniqueDeposit.refundableAmount > 0
                    ? uniqueDeposit.refundableAmount
                    : uniqueDeposit.amount;
                require(refundable > 0, "EnergyEscrow::refund: nothing to refund");

                uniqueDeposit.refundableAmount = 0;
                uniqueDeposit.amount -= refundable;
                ENRG.transfer(uniqueDeposit.depositor, refundable);
            }
        }


        //Assistant force compensate
        else {

            //If multi-tasks. Assistants will be compensated the claimable amount
            if(uniqueDeposit.assistantCount > 1) {
                uint256 claimable = uniqueDeposit.claimableAmount;
                require(claimable > 0, "EnergyEscrow::refund: nothing to refund");
                uniqueDeposit.claimableAmount = 0;
                uniqueDeposit.amount -= claimable;
                ENRG.transfer(recipientAddress, claimable);
            }

            //If standard, refund the whole amount and set the claimable/refundable flag to 0
            else {
                uint256 claimable = uniqueDeposit.amount;
                require(claimable > 0, "EnergyEscrow::refund: nothing to refund");
                uniqueDeposit.claimableAmount = 0;
                uniqueDeposit.refundableAmount = 0;
                uniqueDeposit.amount = 0;
                ENRG.transfer(recipientAddress, claimable);
            }
        }


    }


    /**
     * Specifically for owners wanting to remove assistants from a task
     * @param uuid deposit uuid
     * @param recUuid recipient uuid
     */
    function removeRecipient(bytes32 uuid, bytes32 recUuid) external onlyOwner {
        Deposit storage uniqueDeposit = deposits[uuid];
        require(
            uniqueDeposit.depositor != address(0),
            "EnergyEscrow::removeRecipient: invalid uuid"
        );

        int256 recipientIndex = -1;
        for (uint256 i = 0; i < uniqueDeposit.recipients.length; i++) {
            if (uniqueDeposit.recipients[i].uuid == recUuid) {
                recipientIndex = int256(i);
                break;
            }
        }

        require(
            recipientIndex >= 0,
            "EnergyEscrow::removeRecipient: recipient not found"
        );

        for (
            uint256 i = uint256(recipientIndex);
            i < uniqueDeposit.recipients.length - 1;
            i++
        ) {
            uniqueDeposit.recipients[i] = uniqueDeposit.recipients[i + 1];
        }
        uniqueDeposit.recipients.pop();
    }

    /**
     * Deleting tasks
     * @param uuid deposit uuid
     */
    function deleteDeposit(bytes32 uuid) external onlyOwner {
        Deposit storage uniqueDeposit = deposits[uuid];
        require(uniqueDeposit.amount == 0, "There's still an amount left in the deposit");
        delete deposits[uuid];
    }

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
            uint256 assistantCount
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
            uniqueDeposit.assistantCount
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

        for (uint256 i; i < uniqueDeposit.recipients.length; i++) {
            if (uniqueDeposit.recipients[i].uuid == recUuid) {
                return (
                    uniqueDeposit.recipients[i].recipientAddress,
                    uniqueDeposit.recipients[i].claimable,
                    uniqueDeposit.recipients[i].claimed
                );
            }
        }
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
        uint32 claimedRecipients = 0;
        if (uniqueDeposit.recipients.length < 1) {
            return false;
        }

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
