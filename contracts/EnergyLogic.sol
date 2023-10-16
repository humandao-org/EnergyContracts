// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IBalancerQueries } from "@balancer-labs/v2-interfaces/contracts/standalone-utils/IBalancerQueries.sol";
import { IVault } from "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import { IAsset } from "@balancer-labs/v2-interfaces/contracts/vault/IAsset.sol";
import { IExternalWeightedMath } from "@balancer-labs/v2-interfaces/contracts/pool-weighted/IExternalWeightedMath.sol";

import "hardhat/console.sol";

contract EnergyLogic is Ownable{
    using SafeERC20 for IERC20;

    IBalancerQueries immutable BalancerQueries = IBalancerQueries(0xE39B5e3B6D74016b2F6A9673D7d7493B6DF549d5);

    uint256 public maxMintAmount;
    address public energyToken;
    mapping (address => uint) public fixedExchangeRate; // token address => exchange rate (? token = 1 ENRG)
    mapping (address => bool) public dynamicExchangeTokens; // token address => enabled
    address[] public fixedExchangeTokens;

    error InvalidParams();
    error InvalidParamsLength();
    error InvalidParamsZeroAddress();
    error InvalidParamsZeroValue();
    error MaxMintAmount();
    error Underpaid();
    error NotEnoughFunds();
    error OnlyEnergy();

    constructor(
        uint256 _maxMint,
        address[] memory _fixedExchangeTokens, 
        uint256[] memory _fixedExchangeRates,
        address[] memory _dynamicExchangeTokens
    ) {
        setMaxMintAmount(_maxMint);
        setFixedExchangeRates(_fixedExchangeTokens, _fixedExchangeRates);
        setDynamicExchangeTokens(_dynamicExchangeTokens);
    }

    function setEnergyToken(address _energyToken) 
        public 
        onlyOwner 
    {
        energyToken = _energyToken;
    }

    function setMaxMintAmount(uint256 _maxMintAmount) 
        public 
        onlyOwner 
    {
        if(_maxMintAmount == 0) revert InvalidParamsZeroValue();
        maxMintAmount = _maxMintAmount;
    }

    function setFixedExchangeRates(address[] memory _fixedExchangeTokens, uint256[] memory _fixedExchangeRates) 
        public 
        onlyOwner 
    {
        if(_fixedExchangeTokens.length != _fixedExchangeRates.length) revert InvalidParamsLength();

        fixedExchangeTokens = _fixedExchangeTokens;
        for(uint8 i = 0; i < _fixedExchangeTokens.length; i++) {
            if(_fixedExchangeTokens[i] == address(0)) revert InvalidParamsZeroAddress();
            if(_fixedExchangeRates[i] == 0) revert InvalidParamsZeroValue();
            fixedExchangeRate[_fixedExchangeTokens[i]] = _fixedExchangeRates[i];
        }
    }

    function setDynamicExchangeTokens(address[] memory _dynamicExchangeTokens) 
        public 
        onlyOwner 
    {
        if(_dynamicExchangeTokens.length == 0) revert InvalidParamsLength();

        for(uint8 i = 0; i < _dynamicExchangeTokens.length; i++) {
            if(_dynamicExchangeTokens[i] == address(0)) revert InvalidParamsZeroAddress();
            dynamicExchangeTokens[_dynamicExchangeTokens[i]] = true;
        }
    }

    function beforeMint(address _to, uint256 _amount, address _paymentToken) 
        public 
        onlyEnergy
        returns (address, uint256)
    {
        if(_amount > maxMintAmount) revert MaxMintAmount();
        if(fixedExchangeRate[_paymentToken] == 0) revert InvalidParamsZeroValue();

        uint256 _price = fixedExchangeRate[_paymentToken]*_amount;

        IERC20 paymentToken = IERC20(_paymentToken);
        if(paymentToken.allowance(_to, address(energyToken)) < _price) revert Underpaid();

        return (_paymentToken, _price);
    }

    function afterMint(address _to, uint256 _amount, address _paymentToken, uint256 _price) 
        public 
        onlyEnergy
    {
    }

    function beforeMintWithDynamic(address _to, uint256 _amount, address _paymentToken, uint256 _offlinePrice) 
        public 
        onlyEnergy
        returns (address, uint256)
    {
        if(_amount > maxMintAmount) revert MaxMintAmount();
        if(!dynamicExchangeTokens[_paymentToken]) revert InvalidParamsZeroValue();

        // Ask Balancer for a price quote of HDAO/ETH and for ETH/USDC so we can know the current HDAO USDC price from balancer.
        uint256 _price = getPrice(_amount, _paymentToken);

        // Compare the previous price with the provided as a param (the "offchain" price).
        // If these two prices deviates by a given percentage then the process is aborted.
        uint256 acceptedDeviationPercentage = 10; // 10%
        if(_price*((100+acceptedDeviationPercentage)/100) > _offlinePrice || _price*((100-acceptedDeviationPercentage)/100) < _offlinePrice) revert InvalidParams();

        return (_paymentToken, _price);
    }

    function afterMintWithDynamic(address _to, uint256 _amount, address _paymentToken, uint256 _price) 
        public 
        onlyEnergy
    {
        // Transfer to this contract the _price of _paymentToken from energyContract

        // Swap the payment token to whatever wanted
    }

    function beforeBurn(address _to, uint256 _amount, address  _paymentTokenAddress) 
        public 
        view
        onlyEnergy
        returns (address, uint256)
    {
        if(fixedExchangeRate[_paymentTokenAddress] == 0) revert InvalidParamsZeroValue();

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

    function getSwapPrice(uint256 _amount, bytes32 _poolId, address _tokenIn, address _tokenOut)
        public 
        returns (uint256)
    {       
        IVault.SingleSwap memory _singleSwap = IVault.SingleSwap({
            poolId: _poolId,
            kind: IVault.SwapKind.GIVEN_IN,
            assetIn: IAsset(_tokenIn),
            assetOut: IAsset(_tokenOut),
            amount: _amount,
            userData: new bytes(0)
        });

        IVault.FundManagement memory _funds = IVault.FundManagement({
            sender: address(this),
            fromInternalBalance: false,
            recipient: payable(address(this)),
            toInternalBalance: false
        });

        return BalancerQueries.querySwap(_singleSwap, _funds);
    }
   
    // Calculates the price of the amount of energy in the payment token
    function getPrice(uint256 _amount, address _paymentToken) 
        public 
        returns (uint256)
    {
        bytes32 _poolId_usdceth = 0x10f21c9bd8128a29aa785ab2de0d044dcdd79436000200000000000000000059;
        address _weth = 0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619;
        address _usdc = 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174;
        bytes32 _poolId_hdaoeth = 0xb53f4e2f1e7a1b8b9d09d2f2739ac6753f5ba5cb000200000000000000000137;
        address _hdao = 0x72928d5436Ff65e57F72D5566dCd3BaEDC649A88;

        uint256 _hdaoPrice = getSwapPrice(1 * 10**18, _poolId_hdaoeth, _hdao, _weth);
        uint256 _ethPrice = getSwapPrice(1 * 10**18, _poolId_usdceth, _weth, _usdc) * 10**12; // USDC has only 6 decimals, we need to add some 0s
        uint256 _HDAOUSDCPrice = (_hdaoPrice*_ethPrice) / 10**18;
        return  _amount * 26 * 10**17 / _HDAOUSDCPrice;
    }

    modifier onlyEnergy() {
        if(energyToken != _msgSender()) revert OnlyEnergy();
        _;
    }
}