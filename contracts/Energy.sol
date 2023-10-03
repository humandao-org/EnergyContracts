// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./EnergyLogic.sol";

contract Energy is ERC20, Pausable, Ownable {
    using SafeERC20 for IERC20;

    address public energyLogic;

    error InvalidParams();

    event Mint(address indexed _to, uint256 _amount, address indexed _paymentToken, uint256 _price);
    event Burn(address indexed _from, uint256 _amount, address indexed _paymentToken, uint256 _price);
    event Withdrawal(uint amount, address erc20, uint when);

    constructor(address _energyLogic) ERC20("Energy", "ENRG") {
        setEnergyLogic(_energyLogic);
    }

    function decimals() public view virtual override returns (uint8) {
        return 1;
    }

    function setEnergyLogic(address _energyLogic) 
        public 
        onlyOwner 
    {
        energyLogic = _energyLogic;
    }

    function pause() 
        public 
        onlyOwner 
    {
        _pause();
    }

    function unpause() 
        public 
        onlyOwner 
    {
        _unpause();
    }

    function mint(address _to, uint256 _amount, address _paymentToken)
        public 
        whenNotPaused
    {
        if(_amount == 0) revert InvalidParams();
        if(_paymentToken == address(0)) revert InvalidParams();

        (address _token, uint256 _price) = EnergyLogic(energyLogic).beforeMint(_to, _amount, _paymentToken);
        
        IERC20(_token).safeTransferFrom(_to, address(this), _price);
        _mint(_to, _amount);

        EnergyLogic(energyLogic).afterMint(_to, _amount, _paymentToken);
       
        emit Mint(_to, _amount, _paymentToken, _price);
    }

    function _beforeTokenTransfer(address _from, address _to, uint256 _amount) 
        internal 
        virtual 
        whenNotPaused
        override(ERC20) 
    {
        super._beforeTokenTransfer(_from, _to, _amount);
    }

    function burn(uint256 _amount, address _paymentTokenAddress)
        public
    {
        if(_amount == 0) revert InvalidParams();

        (address _token, uint256 _price) = EnergyLogic(energyLogic).beforeBurn(_msgSender(), _amount, _paymentTokenAddress);

        _burn(_msgSender(), _amount);
        IERC20(_token).safeTransfer(_msgSender(), _price);

        EnergyLogic(energyLogic).afterBurn(_msgSender(), _amount, _paymentTokenAddress, _price);

        emit Burn(_msgSender(), _amount, _paymentTokenAddress, _price);
    }

    function withdraw(address _erc20) 
        public 
        onlyOwner
    {       
        IERC20 _withdrawToken = IERC20(_erc20);
        uint _balance = _withdrawToken.balanceOf(address(this));

        _withdrawToken.safeTransfer(owner(), _balance);

        emit Withdrawal(_balance, _erc20, block.timestamp);
    }
}