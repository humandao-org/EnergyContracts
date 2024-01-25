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

    event ClaimMade(bytes32 indexed uuid, bytes32 indexed recipientUuid, address indexed recipientAddress, uint256 amount);

    event RefundIssued(bytes32 indexed uuid, uint256 amount);
    event DepositDeleted(bytes32 indexed uuid);
    event ENRGSet(address indexed newENRGAddress);
    event AssistantAddressUpdated(bytes32 indexed uuid, bytes32 indexed recipientUuid, address indexed newAddress);
    event DepositorUpdated(bytes32 indexed uuid, address indexed oldDepositor, address indexed newDepositor);

    constructor(IERC20 _ENRG) Ownable(msg.sender) {
        ENRG = _ENRG;
    }

    /**
     * Called by owners creating tasks
     * @param uuid deposit uuid
     * @param amount amount of ENRG being deposited
     */
    function createDeposit(
        bytes32 uuid,
        uint256 amount,
        uint32 assistantCount
    ) external {
        require(assistantCount > 0, "EnergyEscrow: Invalid assistant count");
        Deposit storage deposit = deposits[uuid];
        require(deposit.depositor == address(0), "EnergyEscrow: Deposit exists");

        _checkAllowance(msg.sender, amount);
        ENRG.transferFrom(msg.sender, address(this), amount);

        deposit.amount = amount;
        deposit.allowRefund = true;
        deposit.assistantCount = assistantCount;

        // For single assistant, set refundableAmount to the total amount
        if (assistantCount == 1) {
            deposit.refundableAmount = amount;
        } else {
            // For multiple assistants, calculate claimableAmount and set refundableAmount
            deposit.claimableAmount = amount / assistantCount;
            deposit.refundableAmount = amount;
        }

        deposit.depositor = msg.sender;
    }


    /**
     * @dev Creates a new open-ended deposit.
     * @param uuid Unique identifier for the deposit.
     * @param amount Total amount of ENRG being deposited.
     * @param claimableAmount Amount of ENRG claimable per recipient.
     */
    function createOpenEndedDeposit(
        bytes32 uuid,
        uint256 amount,
        uint256 claimableAmount
    ) external {
        require(deposits[uuid].depositor == address(0), "EnergyEscrow: Deposit exists");
        
        _checkAllowance(msg.sender, amount);
        ENRG.transferFrom(msg.sender, address(this), amount);

        Deposit storage deposit = deposits[uuid];
        deposit.depositor = msg.sender;
        deposit.amount = amount;
        deposit.allowRefund = true;
        deposit.isOpenEnded = true;
        deposit.claimableAmount = claimableAmount;
        deposit.refundableAmount = amount;
    }


    /**
     * @dev Allows additional deposits to an existing open-ended deposit.
     * @param uuid The unique identifier of the open-ended deposit.
     * @param amount The amount of ENRG to be added to the deposit.
     */
    function depositForOpenEnded(bytes32 uuid, uint256 amount) external {
        Deposit storage deposit = deposits[uuid];

        require(deposit.depositor != address(0), "EnergyEscrow: Invalid deposit");
        _checkOpenEnded(deposit);
        _checkAllowance(msg.sender, amount);

        ENRG.transferFrom(msg.sender, address(this), amount);
        deposit.amount += amount;
    }


    /**
     * @dev Increases the energy amount of an existing deposit.
     * @param uuid Unique identifier for the deposit.
     * @param amount Additional amount of ENRG to be added.
     */
    function increaseEnergyAmount(bytes32 uuid, uint256 amount) external {
        Deposit storage deposit = deposits[uuid];
        require(msg.sender == deposit.depositor, "EnergyEscrow: Unauthorized");
        require(!deposit.isOpenEnded, "EnergyEscrow: Open-ended deposit");
        require(deposit.assistantCount > 0, "EnergyEscrow: Invalid assistant count");

        _checkAllowance(msg.sender, amount);
        ENRG.transferFrom(msg.sender, address(this), amount);
        deposit.amount += amount;

        if (deposit.assistantCount == 1) {
            // For a single assistant, the entire deposit amount is claimable or refundable
            deposit.claimableAmount = deposit.refundableAmount == 0 ? deposit.amount : 0;
            deposit.refundableAmount = deposit.claimableAmount == 0 ? deposit.amount : 0;
        } else {
            // For multiple assistants, calculate new claimable amount per assistant
            uint256 newClaimableAmount = (deposit.claimableAmount * deposit.assistantCount + amount) / deposit.assistantCount;
            require(newClaimableAmount > deposit.claimableAmount, "EnergyEscrow: Decrease in claimable amount");

            _handleCompensationAdjustment(deposit, newClaimableAmount);
            deposit.claimableAmount = newClaimableAmount;
            deposit.refundableAmount = deposit.amount;
        }
    }



    /**
     * @dev Increases the claimable energy amount for an open-ended deposit.
     * @param uuid The unique identifier of the deposit.
     * @param claimableAmount The new claimable amount of ENRG for the deposit.
     */
    function increaseEnergyAmountForOpenEnded(
        bytes32 uuid,
        uint256 claimableAmount
    ) external {
        Deposit storage deposit = deposits[uuid];

        require(deposit.depositor != address(0), "EnergyEscrow: Deposit not found");
        _checkOpenEnded(deposit);
        require(claimableAmount > deposit.claimableAmount, "EnergyEscrow: Lower claimable amount");

        deposit.claimableAmount = claimableAmount;
    }

    /**
     * @dev Increases the assistant count for a non-open-ended deposit.
     * @param uuid The unique identifier of the deposit.
     * @param assistantCount The new number of assistants.
     * @param amount The additional amount of ENRG being deposited.
     */
    function increaseAssistantCount(
        bytes32 uuid,
        uint32 assistantCount,
        uint256 amount
    ) external {
        Deposit storage deposit = deposits[uuid];

        require(!deposit.isOpenEnded, "EnergyEscrow: Deposit is open-ended");
        require(deposit.assistantCount > 1, "EnergyEscrow: Invalid assistant count");
        require(assistantCount > deposit.assistantCount, "EnergyEscrow: Lower assistant count");

        uint256 requiredAmount = deposit.claimableAmount * (assistantCount - deposit.assistantCount);
        require(amount == requiredAmount, "EnergyEscrow: Incorrect amount");

        _checkAllowance(msg.sender, amount);
        ENRG.transferFrom(msg.sender, address(this), amount);

        deposit.assistantCount = assistantCount;
        deposit.amount += amount;
        deposit.refundableAmount = deposit.amount;
    }


    /**
     * @dev Increases both the assistant count and the energy amount for a non-open-ended deposit.
     * @param uuid The unique identifier of the deposit.
     * @param assistantCount The new number of assistants.
     * @param amount The additional amount of ENRG being deposited.
     * @param claimableAmount The new claimable amount per assistant.
     */
    function increaseAssistantCountAndEnergyCount(
        bytes32 uuid,
        uint32 assistantCount,
        uint256 amount,
        uint256 claimableAmount
    ) external {
        Deposit storage deposit = deposits[uuid];

        require(!deposit.isOpenEnded, "EnergyEscrow: Open-ended deposit");
        require(deposit.assistantCount > 1, "EnergyEscrow: Invalid assistant count");
        require(assistantCount > deposit.assistantCount, "EnergyEscrow: Lower assistant count");
        require(claimableAmount > deposit.claimableAmount, "EnergyEscrow: Lower claimable amount");

        uint256 newTotalAmount = assistantCount * claimableAmount;
        uint256 currentTotalAmount = deposit.assistantCount * deposit.claimableAmount;
        uint256 requiredAmount = newTotalAmount - currentTotalAmount;
        require(amount == requiredAmount, "EnergyEscrow: Incorrect amount");

        _checkAllowance(msg.sender, amount);
        ENRG.transferFrom(msg.sender, address(this), amount);

        deposit.amount += amount;
        _handleCompensationAdjustment(deposit, claimableAmount);
        deposit.assistantCount = assistantCount;
        deposit.refundableAmount = deposit.amount;
    }


    /**
     * @dev Sets the ENRG token contract address.
     * @param _ENRG The address of the new ENRG token contract.
     */
    function setENRG(IERC20 _ENRG) external onlyOwner {
        require(address(_ENRG) != address(0), "EnergyEscrow: Invalid ENRG address");
        ENRG = _ENRG;
        emit ENRGSet(address(_ENRG));
    }


    /**
     * @dev Sets the refundability of a specific deposit.
     * @param uuid The unique identifier of the deposit.
     * @param allow Boolean indicating whether refunds are allowed for this deposit.
     */
    function setAllowRefund(bytes32 uuid, bool allow) external onlyOwner {
        require(deposits[uuid].depositor != address(0), "EnergyEscrow: Deposit not found");
        deposits[uuid].allowRefund = allow;
    }


    /**
     * @dev Adds a new recipient to a specific deposit.
     * @param uuid The unique identifier of the deposit.
     * @param recipient The address of the recipient.
     * @param recipientUuid The unique identifier for the recipient.
     */
    function addRecipient(
        bytes32 uuid,
        address recipient,
        bytes32 recipientUuid
    ) external onlyOwner {
        Deposit storage deposit = deposits[uuid];

        require(deposit.depositor != address(0), "EnergyEscrow: Invalid deposit");
        require(recipient != address(0), "EnergyEscrow: Invalid recipient");

        if (!deposit.isOpenEnded) {
            require(deposit.recipients.length < deposit.assistantCount, "EnergyEscrow: Max recipients reached");
        } else {
            require(deposit.amount > deposit.claimableAmount, "EnergyEscrow: Insufficient balance for new recipient");
        }

        Recipient memory newRecipient = Recipient({
            uuid: recipientUuid,
            recipientAddress: recipient,
            claimed: false,
            claimable: false
        });
        deposit.recipients.push(newRecipient);
        recipientIndex[uuid][recipientUuid] = deposit.recipients.length - 1;

        if (deposit.assistantCount == 1) {
            deposit.claimableAmount = deposit.amount;
            deposit.refundableAmount = 0;
        }
    }


    /**
     * @dev Sets a recipient's status to claimable for a specific deposit.
     * @param uuid The unique identifier of the deposit.
     * @param recUuid The unique identifier of the recipient.
     */
    function setClaimable(bytes32 uuid, bytes32 recUuid) external onlyOwner {
        Deposit storage deposit = deposits[uuid];
        uint256 index = recipientIndex[uuid][recUuid];
        require(index < deposit.recipients.length, "EnergyEscrow: Recipient not found");

        deposit.recipients[index].claimable = true;
    }


    /**
     * @dev Allows a recipient to claim their allocated ENRG from a deposit.
     * @param uuid The unique identifier of the deposit.
     * @param recipientUuid The unique identifier of the recipient.
     */
    function claim(bytes32 uuid, bytes32 recipientUuid) external {
        Deposit storage deposit = deposits[uuid];
        require(deposit.recipients.length > 0, "EnergyEscrow: No recipients");

        uint256 index = recipientIndex[uuid][recipientUuid];
        require(index < deposit.recipients.length, "EnergyEscrow: Recipient not found");

        Recipient storage recipient = deposit.recipients[index];
        require(msg.sender == recipient.recipientAddress, "EnergyEscrow: Unauthorized recipient");
        require(recipient.claimable, "EnergyEscrow: Not claimable");
        require(!recipient.claimed, "EnergyEscrow: Already claimed");

        uint256 individualClaimAmount = deposit.claimableAmount;
        deposit.amount -= individualClaimAmount;
        if (deposit.assistantCount == 1) {
            deposit.claimableAmount = 0;
        } else {
            deposit.refundableAmount -= individualClaimAmount;
        }

        recipient.claimed = true;
        ENRG.transfer(msg.sender, individualClaimAmount);
        // Emit an event after a successful claim
        emit ClaimMade(uuid, recipientUuid, msg.sender, individualClaimAmount);
    }


    /**
     * @dev Refunds the deposit amount to the depositor under certain conditions.
     * @param uuid The unique identifier of the deposit.
     */
    function refund(bytes32 uuid) external {
        Deposit storage deposit = deposits[uuid];
        require(
            (msg.sender == deposit.depositor && deposit.allowRefund) || msg.sender == owner(),
            "EnergyEscrow: Unauthorized or refund not allowed"
        );

        require(deposit.recipients.length == 0, "EnergyEscrow: Recipients present");
        uint256 refundableAmount = deposit.isOpenEnded ? deposit.amount : deposit.refundableAmount;
        require(refundableAmount > 0, "EnergyEscrow: Nothing to refund");

        deposit.amount -= refundableAmount;
        deposit.claimableAmount = 0;
        deposit.refundableAmount = 0;

        ENRG.transfer(deposit.depositor, refundableAmount);

        emit RefundIssued(uuid, refundableAmount);
    }


    /**
     * @dev Forcefully refunds the deposit under special circumstances by the owner.
     * @param uuid The unique identifier of the deposit.
     * @param recipientUuid The unique identifier of the recipient.
     * @param targetAddress The address to which the refund will be made.
     */
    function forceRefund(
        bytes32 uuid,
        bytes32 recipientUuid,
        address targetAddress
    ) external onlyOwner {
        Deposit storage deposit = deposits[uuid];
        Recipient storage recipient = deposit.recipients[recipientIndex[uuid][recipientUuid]];

        require(
            targetAddress == deposit.depositor || targetAddress == recipient.recipientAddress,
            "EnergyEscrow: Target address mismatch"
        );

        targetAddress == deposit.depositor ? _ownerRefund(deposit) : _assistantRefund(deposit, recipient);
    }

    /**
     * @dev Removes a recipient from a specific deposit.
     * @param uuid The unique identifier of the deposit.
     * @param recUuid The unique identifier of the recipient to be removed.
     */
    function removeRecipient(bytes32 uuid, bytes32 recUuid) external onlyOwner {
        Deposit storage deposit = deposits[uuid];
        require(deposit.depositor != address(0), "EnergyEscrow: Invalid deposit");

        uint256 index = recipientIndex[uuid][recUuid];
        require(index < deposit.recipients.length, "EnergyEscrow: Recipient not found");

        Recipient storage recipientToRemove = deposit.recipients[index];
        require(
            !(recipientToRemove.claimable && !recipientToRemove.claimed),
            "EnergyEscrow: Recipient in claimable state"
        );

        // Efficient removal pattern for an unordered array
        if (index < deposit.recipients.length - 1) {
            deposit.recipients[index] = deposit.recipients[deposit.recipients.length - 1];
            recipientIndex[uuid][deposit.recipients[index].uuid] = index;
        }
        deposit.recipients.pop();
        delete recipientIndex[uuid][recUuid];

    }


    /**
     * @dev Deletes a deposit from the contract. Can only be done when the deposit's amount is zero.
     * @param uuid The unique identifier of the deposit to delete.
     */
    function deleteDeposit(bytes32 uuid) external onlyOwner {
        require(deposits[uuid].amount == 0, "EnergyEscrow: Deposit not empty");

        delete deposits[uuid];
        emit DepositDeleted(uuid);
    }


    /**
     * @dev Sets a new depositor address for a specific deposit.
     * @param uuid The unique identifier of the deposit.
     * @param newAddress The new address of the depositor.
     */
    function setDepositor(bytes32 uuid, address newAddress) external onlyOwner {
        require(newAddress != address(0), "EnergyEscrow: Invalid address");
        require(deposits[uuid].depositor != address(0), "EnergyEscrow: Deposit not found");

        address oldDepositor = deposits[uuid].depositor;
        deposits[uuid].depositor = newAddress;

        emit DepositorUpdated(uuid, oldDepositor, newAddress);
    }


    /**
     * @dev Updates the address of an assistant (recipient) for a specific deposit.
     * This function is intended to allow changing the recipient's address under certain conditions.
     * @param uuid The unique identifier of the deposit.
     * @param recipientUuid The unique identifier of the recipient within the deposit.
     * @param newAddress The new address to be assigned to the recipient.
     */
    function updateAssistantAddress(bytes32 uuid, bytes32 recipientUuid, address newAddress) external onlyOwner {
        require(newAddress != address(0), "EnergyEscrow: Invalid new address");
        Deposit storage deposit = deposits[uuid];
        uint256 index = recipientIndex[uuid][recipientUuid];
        require(index < deposit.recipients.length, "EnergyEscrow: Recipient not found");
        Recipient storage recipient = deposit.recipients[index];
        require(!recipient.claimed, "EnergyEscrow: Cannot change address for claimed deposit");

        recipient.recipientAddress = newAddress;
        emit AssistantAddressUpdated(uuid, recipientUuid, newAddress);
    }


    /**
     * @dev Returns the details of a specific deposit.
     * @param uuid The unique identifier of the deposit.
     * @return depositor The address of the depositor.
     * @return amount The total amount of the deposit.
     * @return claimableAmount The amount claimable from the deposit.
     * @return refundableAmount The amount refundable from the deposit.
     * @return allowRefund Boolean indicating if the deposit is refundable.
     * @return recipientCount The number of recipients associated with the deposit.
     * @return assistantCount The number of assistants allowed for the deposit.
     * @return isOpenEnded Boolean indicating if the deposit is open-ended.
     */
    function viewDeposit(bytes32 uuid)
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
        Deposit storage deposit = deposits[uuid];
        return (
            deposit.depositor,
            deposit.amount,
            deposit.claimableAmount,
            deposit.refundableAmount,
            deposit.allowRefund,
            deposit.recipients.length,
            deposit.assistantCount,
            deposit.isOpenEnded
        );
    }


    /**
     * @dev Provides details of a specific recipient within a deposit.
     * @param uuid The unique identifier of the deposit.
     * @param recUuid The unique identifier of the recipient within the deposit.
     * @return recipientAddress The address of the recipient.
     * @return claimable Indicates if the recipient's deposit is ready to be claimed.
     * @return claimed Indicates if the recipient has already claimed the deposit.
     */
    function viewDepositRecipient(
        bytes32 uuid,
        bytes32 recUuid
    )
        external
        view
        returns (address recipientAddress, bool claimable, bool claimed)
    {
        Deposit storage deposit = deposits[uuid];
        uint256 index = recipientIndex[uuid][recUuid];
        require(index < deposit.recipients.length, "EnergyEscrow: Recipient not found");

        Recipient storage recipient = deposit.recipients[index];
        return (recipient.recipientAddress, recipient.claimable, recipient.claimed);
    }



    /**
     * @dev Calculates the remaining number of claims and acceptances for a given deposit.
     * @param uuid The unique identifier of the deposit.
     * @return claimsRemaining The number of remaining claims that can be made.
     * @return acceptancesRemaining The number of additional recipients that can be accepted.
     */
    function calculateRemainingClaims(
        bytes32 uuid
    )
        external
        view
        returns (uint256 claimsRemaining, uint256 acceptancesRemaining)
    {
        Deposit storage deposit = deposits[uuid];
        uint256 unclaimedCount = 0;

        for (uint256 i = 0; i < deposit.recipients.length; i++) {
            if (!deposit.recipients[i].claimed) {
                unclaimedCount++;
            }
        }

        uint256 recipientsNeeded = (deposit.amount -
            (deposit.claimableAmount * unclaimedCount)) /
            deposit.claimableAmount;

        return (unclaimedCount + recipientsNeeded, recipientsNeeded);
    }

    /**
     * @dev Handles the refund process for deposits, initiated by the contract owner.
     * This function deals with both standard and open-ended tasks, calculating the refundable amount,
     * processing any pending claims, and issuing refunds. It also ensures state updates for deposit and recipient records.
     * Note: This function should be protected against reentrancy attacks and is intended for execution by the contract owner only.
     *
     * @param uniqueDeposit The deposit struct instance (storage pointer) for which the refund is being processed.
     */
    function _ownerRefund(Deposit storage uniqueDeposit) private {
        uint256 claimableAssistant = 0;

        // Process any pending claims for assistants
        if (!uniqueDeposit.isOpenEnded) {
            for (uint256 i = 0; i < uniqueDeposit.recipients.length; i++) {
                Recipient storage recipient = uniqueDeposit.recipients[i];
                if (recipient.claimable && !recipient.claimed) {
                    ENRG.transfer(recipient.recipientAddress, uniqueDeposit.claimableAmount);
                    recipient.claimed = true;
                    claimableAssistant++;
                }
            }
        }

        uint256 refundAmt = uniqueDeposit.amount - (uniqueDeposit.claimableAmount * claimableAssistant);

        // Refund the remaining amount to the depositor, if any
        if (refundAmt > 0) {
            ENRG.transfer(uniqueDeposit.depositor, refundAmt);
        }

        // Reset deposit amounts to zero after refund
        uniqueDeposit.amount = 0;
        uniqueDeposit.claimableAmount = 0;
        uniqueDeposit.refundableAmount = 0;
    }


    /**
     * @dev Handles the refund process for an assistant (recipient). This function is called
     * under specific conditions where a refund is due to an assistant.
     * It calculates the refundable amount based on whether the deposit is for multi-assistant or standard tasks.
     * The function then updates the deposit's state accordingly and transfers the claimable ENRG to the recipient.
     * Note: This function should be guarded against reentrancy attacks.
     *
     * @param uniqueDeposit The deposit from which the refund is being processed. This is a storage pointer to the Deposit struct.
     * @param recipient The recipient to whom the refund is being issued. This is a memory reference to the Recipient struct.
     */
    function _assistantRefund(
        Deposit storage uniqueDeposit,
        Recipient storage recipient
    ) private {
        uint256 claimable = uniqueDeposit.assistantCount > 1 ? 
                            uniqueDeposit.claimableAmount : 
                            uniqueDeposit.amount;
        
        // Early return if there is nothing to refund
        if (claimable == 0) return;

        // Update deposit's state before transferring funds
        uniqueDeposit.amount -= claimable;
        if (uniqueDeposit.assistantCount > 1) {
            uniqueDeposit.refundableAmount -= claimable;
        } else {
            // For standard tasks, reset the claimable and refundable amounts
            uniqueDeposit.claimableAmount = 0;
            uniqueDeposit.refundableAmount = 0;
        }

        // Update recipient's state to reflect the claim
        recipient.claimable = true;
        recipient.claimed = true;

        // Transfer the claimable amount to the recipient
        ENRG.transfer(recipient.recipientAddress, claimable);
    }


    /**
     * @dev Adjusts the compensation for assistants who have already claimed their ENRG tokens.
     * This function is called when there is a change in the claimable amount per assistant.
     * It iterates through all recipients of a deposit and if they have already claimed,
     * transfers the difference in ENRG tokens based on the new claimable amount.
     * Note: Care must be taken to guard against reentrancy attacks in this function.
     *
     * @param dep The deposit struct instance (storage pointer) whose claimable amount has been adjusted.
     * @param claimableAmount The new claimable amount per assistant.
     */
    function _handleCompensationAdjustment(
        Deposit storage dep,
        uint256 claimableAmount 
    ) private {
        uint256 enrgCompensation = claimableAmount - dep.claimableAmount;
        if (enrgCompensation == 0) {
            return;
        }

        for (uint i = 0; i < dep.recipients.length; i++) {
            if (dep.recipients[i].claimed) {
                ENRG.transfer(dep.recipients[i].recipientAddress, enrgCompensation);
                dep.amount -= enrgCompensation;
            }
        }
    }


    function _checkAllowance(address owner, uint256 amount) internal view {
        uint256 allowance = ENRG.allowance(owner, address(this));
        require(allowance >= amount, "Insufficient allowance");
    }

    function _checkOpenEnded(Deposit storage uniqueDeposit) internal view {
        require(uniqueDeposit.isOpenEnded, "Deposit must be open ended");
    }
    function _checkMultiAssistantDeposit(Deposit storage uniqueDeposit) internal view {
        require(uniqueDeposit.assistantCount > 1, "Deposit must have more than 1 assistant count");
    }
    function _checkStandardDeposit(Deposit storage uniqueDeposit) internal view {
        require(uniqueDeposit.isOpenEnded, "Deposit must have only 1 assistant count");
    }
}
