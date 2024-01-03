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
        uint assistantCount;
    }
    IERC20 public ENRG;
    mapping (bytes32 => Deposit) public deposits;

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
        require(allowance >= amount, "EnergyEscrow::deposit: please approve tokens before depositing");
        ENRG.transferFrom(msg.sender, address(this), amount);

        // aggregate deposits of the same uuid
        uniqueDeposit.amount += amount;

        if(uniqueDeposit.depositor == address(0)) {
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
     * To manually set the refundable amount for the task
     * @param uuid deposit uuid 
     * @param claimableAmount claimable amount
     * @param refundableAmount refundable amount
     */
    function setAmounts(bytes32 uuid, uint256 claimableAmount, uint256 refundableAmount, uint32 assistantCount) external onlyOwner {
        Deposit storage uniqueDeposit = deposits[uuid];
        if(assistantCount == 1) {
            require(uniqueDeposit.amount >= claimableAmount + refundableAmount, "EnergyEscrow::setAmounts: total amount is not equal to the remaining balance");
        }

        uniqueDeposit.claimableAmount = claimableAmount;
        uniqueDeposit.refundableAmount = refundableAmount;
        //If assistant count lowers. automatic refund
        if(uniqueDeposit.assistantCount != 0 && uniqueDeposit.assistantCount < assistantCount) {
            uint256 enrgToRefund =  uniqueDeposit.claimableAmount * (uniqueDeposit.assistantCount-assistantCount);
            ENRG.transfer(uniqueDeposit.depositor, enrgToRefund);
            uniqueDeposit.amount -= enrgToRefund;
            uniqueDeposit.refundableAmount -= enrgToRefund;
        }
        uniqueDeposit.assistantCount = assistantCount;
    }

    /**
     * Used in assistants accepting tasks
     * @param uuid deposit uuid
     * @param recipient assistant address
     */

    function addRecipient(bytes32 uuid, address recipient, bytes32 recipientUuid) external onlyOwner {
        Deposit storage uniqueDeposit = deposits[uuid];
        require(uniqueDeposit.depositor != address(0), "EnergyEscrow::addRecipient: invalid uuid");
        require(uniqueDeposit.recipients.length <= uniqueDeposit.assistantCount, "EnergyEscrow::addRecipient: Recipients cannot exceed the assistant count");

        //Set initial struc
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
        for(uint i = 0; i < uniqueDeposit.recipients.length; i++) { 
            if(uniqueDeposit.recipients[i].uuid == recUuid) {
                uniqueDeposit.recipients[i].claimable = true;
                break;
            }
        }
    }


    // /**
    //  * Used by assistants when claiming
    //  * @param uuid deposit uuid
    //  * @param recipientUuid recipient uuid
    //  */
    // function claim(bytes32 uuid, bytes32 recipientUuid) external {
    //     Deposit storage uniqueDeposit = deposits[uuid];
    //     require(uniqueDeposit.recipients.length > 0, "EnergyEscrow::claim: no recipients");
    //     uint256 individualClaimAmount = uniqueDeposit.claimableAmount;

    //     for(uint i = 0; i < uniqueDeposit.recipients.length; i++) {
            
    //         if(msg.sender == uniqueDeposit.recipients[i].recipientAddress && recipientUuid == uniqueDeposit.recipients[i].uuid) {
    //             //For single instance tasks 
    //             if (uniqueDeposit.assistantCount == 1){
    //                 require(individualClaimAmount > 0, "EnergyEscrow::claim: nothing to claim");
    //                 require(!uniqueDeposit.recipients[i].claimed, "EnergyEscrow::claim: Already claimed");
    //                 require(uniqueDeposit.recipients[i].claimable, "EnergyEscrow::claim: Deposit is still not claimable");
    //                 uniqueDeposit.amount -= individualClaimAmount;
    //                 uniqueDeposit.refundableAmount -= individualClaimAmount;
    //                 uniqueDeposit.recipients[i].claimed = true;
    //                 ENRG.transfer(msg.sender, individualClaimAmount);
    //                 return;
    //             }
                
    //             //For missions and multi-tasks
    //             else {
    //                 require(individualClaimAmount > 0, "EnergyEscrow::claim: nothing to claim");
    //                 require(!uniqueDeposit.recipients[i].claimed, "EnergyEscrow::claim: Already claimed");
    //                 require(uniqueDeposit.recipients[i].claimable, "EnergyEscrow::claim: Deposit is still not claimable");
    //                 uniqueDeposit.amount -= individualClaimAmount;
    //                 uniqueDeposit.refundableAmount -= individualClaimAmount;
    //                 uniqueDeposit.recipients[i].claimed = true;
    //                 ENRG.transfer(msg.sender, individualClaimAmount);
    //                 break;
    //             }
    //         } 
    //     }
    // }
    
    /**
     * Used by assistants when claiming
     * @param uuid deposit uuid
     * @param recipientUuid recipient uuid
     */
    function claim(bytes32 uuid, bytes32 recipientUuid) external {
    Deposit storage uniqueDeposit = deposits[uuid];
    require(uniqueDeposit.recipients.length > 0, "EnergyEscrow::claim: no recipients");
    uint256 individualClaimAmount = uniqueDeposit.claimableAmount;
    bool isClaimed = false;

    for(uint i = 0; i < uniqueDeposit.recipients.length && !isClaimed; i++) {
        Recipient storage recipient = uniqueDeposit.recipients[i];
        if(msg.sender == recipient.recipientAddress && recipientUuid == recipient.uuid && recipient.claimable && !recipient.claimed) {
            require(individualClaimAmount > 0, "EnergyEscrow::claim: nothing to claim");
            require(recipient.claimable, "EnergyEscrow::claim: Reward should be claimable");
            require(!recipient.claimed, "EnergyEscrow::claim: Reward is already claimed");
            uniqueDeposit.amount -= individualClaimAmount;
            if(uniqueDeposit.assistantCount > 1) {
                    uniqueDeposit.claimableAmount = 0;
                    uniqueDeposit.refundableAmount = 0;
            }
            else {
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
     * Specifically for refunds (setting tasks to draft/deleting tasks)
     * @param uuid deposit uuid
     */
    function refund(bytes32 uuid) external {
        Deposit storage uniqueDeposit = deposits[uuid];
        require(msg.sender == uniqueDeposit.depositor && uniqueDeposit.allowRefund == true, "EnergyEscrow::refund: conditions for refund not met");
        uint256 refundable = uniqueDeposit.refundableAmount > 0 ? uniqueDeposit.refundableAmount : uniqueDeposit.amount;
        require(refundable > 0, "EnergyEscrow::refund: nothing to refund");
        uniqueDeposit.refundableAmount = 0;
        uniqueDeposit.amount -= refundable;
        ENRG.transfer(uniqueDeposit.depositor, refundable);
    }
    
    /**
     * Specifically for owners wanting to remove assistants from a task
     * @param uuid deposit uuid
     * @param recipientToRemove recipient address
     */
    function removeRecipient(bytes32 uuid, address recipientToRemove) external onlyOwner {
        Deposit storage uniqueDeposit = deposits[uuid];
        require(uniqueDeposit.depositor != address(0), "EnergyEscrow::removeRecipient: invalid uuid");

        int256 recipientIndex = -1;
        for(uint256 i = 0; i < uniqueDeposit.recipients.length; i++) {
            if(uniqueDeposit.recipients[i].recipientAddress == recipientToRemove) {
                recipientIndex = int256(i);
                break;
            }
        }

        require(recipientIndex >= 0, "EnergyEscrow::removeRecipient: recipient not found");
        
        for (uint256 i = uint256(recipientIndex); i < uniqueDeposit.recipients.length - 1; i++) {
            uniqueDeposit.recipients[i] = uniqueDeposit.recipients[i + 1];
        }
        uniqueDeposit.recipients.pop();

        uniqueDeposit.refundableAmount += uniqueDeposit.claimableAmount;
    }

    /**
     * Deleting tasks
     * @param uuid deposit uuid
     */
    function deleteDeposit(bytes32 uuid) external onlyOwner {
        delete deposits[uuid];
    }
    
    /**
     * 
     * @param uuid deposit uuid
     * @return depositor depositor address
     * @return amount amount of ENRG deposited
     * @return claimableAmount claimable amount
     * @return refundableAmount refundable amount
     * @return allowRefund If the deposit is refundable
     * @return recipientCount number of recipients so far
     * @return assistantCount number of maximum assistants for the task
     */
    function viewDeposit(bytes32 uuid) external view returns (address depositor, uint256 amount, uint256 claimableAmount, uint256 refundableAmount, bool allowRefund, uint256 recipientCount, uint256 assistantCount) {
        Deposit storage uniqueDeposit = deposits[uuid];
        return (uniqueDeposit.depositor, uniqueDeposit.amount, uniqueDeposit.claimableAmount, uniqueDeposit.refundableAmount, uniqueDeposit.allowRefund, uniqueDeposit.recipients.length, uniqueDeposit.assistantCount);
    }

    /**
     * Check if a certain assistant can claim their reward
     * @param uuid deposit uuid
     * @param recUuid recipient uuid
     * @return recipientAddress recipient address
     * @return claimable is deposit claimable
     * @return claimed is deposit claimed
     */
    function viewDepositRecipient(bytes32 uuid, bytes32 recUuid) external view returns (address recipientAddress, bool claimable, bool claimed) {
        Deposit storage uniqueDeposit = deposits[uuid];

        for(uint256 i; i < uniqueDeposit.recipients.length; i++) {
            if(uniqueDeposit.recipients[i].uuid == recUuid) {
                return (uniqueDeposit.recipients[i].recipientAddress, uniqueDeposit.recipients[i].claimable, uniqueDeposit.recipients[i].claimed);
            }
        }
    }
}
