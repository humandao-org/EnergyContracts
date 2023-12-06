// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract EnergyEscrow is Ownable {

    struct Deposit {
        address depositor;
        uint256 amount;
        uint256 claimableAmount;
        uint256 refundableAmount;
        address recipient;
        bool allowRefund;
    }

    IERC20 public ENRG;
    mapping (bytes32 => Deposit) public deposits;

    constructor(IERC20 _ENRG) Ownable(msg.sender) {
        ENRG = _ENRG;
    }

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

    function setAllowRefund(bytes32 uuid, bool allow) external onlyOwner {
        Deposit storage uniqueDeposit = deposits[uuid];
        uniqueDeposit.allowRefund = allow;
    }

    function setAmounts(bytes32 uuid, uint256 claimableAmount, uint256 refundableAmount) external onlyOwner {
        Deposit storage uniqueDeposit = deposits[uuid];
        require(uniqueDeposit.amount == claimableAmount + refundableAmount, "EnergyEscrow::setAmounts: total amount does not match with the deposit amount");
        uniqueDeposit.claimableAmount = claimableAmount;
        uniqueDeposit.refundableAmount = refundableAmount;
        uniqueDeposit.allowRefund = true;
    }

    function addRecipient(bytes32 uuid, address recipient) external onlyOwner {
        Deposit storage uniqueDeposit = deposits[uuid];
        require(uniqueDeposit.depositor != address(0), "EnergyEscrow::addRecipient: invalid uuid");
        uniqueDeposit.recipient = recipient;
    }

    function claim(bytes32 uuid) external {
        Deposit storage uniqueDeposit = deposits[uuid];
        require(msg.sender == uniqueDeposit.recipient, "EnergyEscrow::claim: only recipient can claim deposit");
        uint256 claimable = uniqueDeposit.claimableAmount > 0 ? uniqueDeposit.claimableAmount : uniqueDeposit.amount;
        require(claimable > 0, "EnergyEscrow::claim: nothing to claim");
        uniqueDeposit.claimableAmount = 0;
        uniqueDeposit.amount -= claimable;
        ENRG.transfer(msg.sender, claimable);
    }

    function refund(bytes32 uuid) external {
        Deposit storage uniqueDeposit = deposits[uuid];
        require(msg.sender == uniqueDeposit.depositor && uniqueDeposit.allowRefund == true, "EnergyEscrow::refund: conditions for refund not met");
        uint256 refundable = uniqueDeposit.refundableAmount > 0 ? uniqueDeposit.refundableAmount : uniqueDeposit.amount;
        require(refundable > 0, "EnergyEscrow::refund: nothing to refund");
        uniqueDeposit.refundableAmount = 0;
        uniqueDeposit.amount -= refundable;
        ENRG.transfer(uniqueDeposit.depositor, refundable);
    }

    function deleteDeposit(bytes32 uuid) external onlyOwner {
        delete deposits[uuid];
    }
  
    function viewDeposit(bytes32 uuid) external view returns (address depositor, uint256 amount, uint256 claimableAmount, uint256 refundableAmount, address recipient, bool allowRefund) {
        Deposit storage uniqueDeposit = deposits[uuid];
        return (uniqueDeposit.depositor, uniqueDeposit.amount, uniqueDeposit.claimableAmount, uniqueDeposit.refundableAmount, uniqueDeposit.recipient, uniqueDeposit.allowRefund);
    }
}
