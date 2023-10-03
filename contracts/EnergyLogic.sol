// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract EnergyLogic is Ownable{
    using SafeERC20 for IERC20;

    address energyToken;
    mapping (address => uint) public fixedExchangeRate; // token address => exchange rate (? token = 1 ENRG)
    address[] public fixedExchangeTokens;

    error InvalidParams();
    error Underpaid();
    error NotEnoughFunds();

    constructor(
        address[] memory _fixedExchangeTokens, 
        uint256[] memory _fixedExchangeRates
    ) {
        setFixedExchangeRates(_fixedExchangeTokens, _fixedExchangeRates);
    }

    function setEnergyToken(address _energyToken) 
        public 
        onlyOwner 
    {
        energyToken = _energyToken;
    }

    function setFixedExchangeRates(address[] memory _fixedExchangeTokens, uint256[] memory _fixedExchangeRates) 
        public 
        onlyOwner 
    {
        if(_fixedExchangeTokens.length != _fixedExchangeRates.length) revert InvalidParams();

        fixedExchangeTokens = _fixedExchangeTokens;
        for(uint8 i = 0; i < _fixedExchangeTokens.length; i++) {
            if(_fixedExchangeTokens[i] == address(0)) revert InvalidParams();
            if(_fixedExchangeRates[i] == 0) revert InvalidParams();
            fixedExchangeRate[_fixedExchangeTokens[i]] = _fixedExchangeRates[i];
        }
    }

    function beforeMint(address _to, uint256 _amount, address _paymentToken) 
        public 
        onlyEnergy
        returns (address, uint256)
    {
        if(fixedExchangeRate[_paymentToken] == 0) revert InvalidParams();

        uint256 _price = fixedExchangeRate[_paymentToken]*_amount;
        IERC20 paymentToken = IERC20(_paymentToken);
        if(paymentToken.allowance(_to, address(energyToken)) < _price) revert Underpaid();

        return (_paymentToken, _price);
    }

    function afterMint(address _to, uint256 _amount, address _paymentToken) 
        public 
        onlyEnergy
    {
    }

    function beforeBurn(address _to, uint256 _amount, address  _paymentTokenAddress) 
        public 
        view
        onlyEnergy
        returns (address, uint256)
    {
        if(fixedExchangeRate[_paymentTokenAddress] == 0) revert InvalidParams();

        uint256 _price = fixedExchangeRate[_paymentTokenAddress]*_amount;
        IERC20 _paymentToken = IERC20(_paymentTokenAddress);
        if(_paymentToken.balanceOf(energyToken) < _price) revert NotEnoughFunds();

        return (address(_paymentToken), _price);
    }

    function afterBurn(address _to, uint256 _amount, address  _paymentTokenAddress, uint256 _price) 
        public 
        onlyEnergy
    {   
    }

    modifier onlyEnergy() {
        require(energyToken == _msgSender(), "OnlyEnergy: caller is not the Energy Token");
        _;
    }
}