// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import { IBalancerQueries } from "@balancer-labs/v2-interfaces/contracts/standalone-utils/IBalancerQueries.sol";
import { IVault } from "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import { IAsset } from "@balancer-labs/v2-interfaces/contracts/vault/IAsset.sol";

import "./Energy.sol";

contract Factory is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20Metadata;

    address immutable HDAO_TOKEN_ADDRESS = 0x72928d5436Ff65e57F72D5566dCd3BaEDC649A88;
    address immutable USDC_TOKEN_ADDRESS = 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174;
    address immutable WETH_TOKEN_ADDRESS = 0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619;
    bytes32 immutable USDCWETH_POOLID = 0x10f21c9bd8128a29aa785ab2de0d044dcdd79436000200000000000000000059;
    bytes32 immutable HDAOWETH_POOLID = 0xb53f4e2f1e7a1b8b9d09d2f2739ac6753f5ba5cb000200000000000000000137;
    IBalancerQueries immutable BalancerQueries = IBalancerQueries(0xE39B5e3B6D74016b2F6A9673D7d7493B6DF549d5);
    IVault immutable BalancerVault = IVault(0xBA12222222228d8Ba445958a75a0704d566BF2C8);
    uint256 immutable USDC_PRICE = 26 * 10**17;

    address public trustedSigner;
    address public energyToken;
    uint256 public maxMintAmount;
    mapping (address => uint) public fixedExchangeRate; // token address => exchange rate (? token = 1 ENRG)
    mapping (address => bytes32) public dynamicExchangeTokens; // token address => WETH-Token Balancer pool id
    address[] public fixedExchangeTokens;
    uint8 public dynamicExchangeAcceptedDeviationPercentage;

    error InvalidParams();
    error InvalidParamsLength();
    error InvalidParamsZeroAddress();
    error InvalidParamsZeroValue();
    error MaxMintAmount();
    error Underpaid();
    error NotEnoughFunds();
    error OnlyEnergy();
    error UnacceptablePriceDeviation();
    error InvalidSignature();

    event Mint(address indexed _to, uint256 _amount, address indexed _paymentToken, uint256 _price);
    event Burn(address indexed _from, uint256 _amount, address indexed _paymentToken, uint256 _price);
    event Withdrawal(uint amount, address erc20, uint when);

    constructor(
        address _initialOwner, 
        address _energyToken,
        uint256 _maxMint,
        address[] memory _fixedExchangeTokens, 
        uint256[] memory _fixedExchangeRates,
        address[] memory _dynamicExchangeTokens,
        bytes32[] memory _dynamicExchangePools
    )
        Ownable(_initialOwner)
    {
        energyToken = _energyToken;
        setMaxMintAmount(_maxMint);
        setFixedExchangeRates(_fixedExchangeTokens, _fixedExchangeRates);
        setDynamicExchangeTokens(_dynamicExchangeTokens, _dynamicExchangePools);
        dynamicExchangeAcceptedDeviationPercentage = 10;
        trustedSigner = _initialOwner;
    }

    /**
     * Sets the amount of energy that can be minted per transaction.
     * 
     * @dev Throws if called by any account other than the energy token.
     */
    function setMaxMintAmount(uint256 _maxMintAmount) 
        public 
        onlyOwner 
    {
        if(_maxMintAmount == 0) revert InvalidParamsZeroValue();

        maxMintAmount = _maxMintAmount;
    }

    /**
     * Sets the fixed exchange rates for the tokens.
     * 
     * @param _fixedExchangeTokens array of token addresses
     * @param _fixedExchangeRates array of exchage rates (price per 1 ENRG token)
     */
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

    /**
     * Set the tokens that can be used for minting, with a dynamic exchange rate, from a Balancer pool.
     * 
     * @param _dynamicExchangeTokens array of token addresses
     * @param _dynamicExchangePools array of Balancer pool ids (WETH-Token pools)
     */
    function setDynamicExchangeTokens(address[] memory _dynamicExchangeTokens, bytes32[] memory _dynamicExchangePools) 
        public 
        onlyOwner 
    {
        if(_dynamicExchangeTokens.length == 0) revert InvalidParamsLength();
        if(_dynamicExchangePools.length == 0) revert InvalidParamsLength();
        if(_dynamicExchangeTokens.length != _dynamicExchangePools.length) revert InvalidParamsLength();

        for(uint8 i = 0; i < _dynamicExchangeTokens.length; i++) {
            if(_dynamicExchangeTokens[i] == address(0)) revert InvalidParamsZeroAddress();
            if(_dynamicExchangePools[i] == 0) revert InvalidParamsZeroValue();
            dynamicExchangeTokens[_dynamicExchangeTokens[i]] = _dynamicExchangePools[i];
        }
    }

    /**
     * Set the deviation percentage from the provided price and the price from Balancer. 
     * If the deviation is higher than the provided percentage, the transaction will be reverted.
     * 
     * @param _dynamicExchangeAcceptedDeviationPercentage percentage of deviation
     */
    function setDynamicExchangeAcceptedDeviationPercentage(uint8 _dynamicExchangeAcceptedDeviationPercentage) 
        public 
        onlyOwner 
    {
        if(_dynamicExchangeAcceptedDeviationPercentage == 0) revert InvalidParamsZeroValue();

        dynamicExchangeAcceptedDeviationPercentage = _dynamicExchangeAcceptedDeviationPercentage;
    }

    /**
     * Set the trusted signer address. Will be used for offline price signature verification
     * 
     * @param _trustedSigner address of the trusted signer
     */
    function setTrustedSigner(address _trustedSigner) 
        public 
        onlyOwner 
    {
        if(_trustedSigner == address(0)) revert InvalidParamsZeroAddress();

        trustedSigner = _trustedSigner;
    }

    /**
     * Minting with fixed exchange rate (stablecoin)
     * 
     * @param _amount to be minted
     * @param _paymentTokenAddress to be used for payment
     */
    function mint(uint256 _amount, address _paymentTokenAddress)
        public 
        nonReentrant
    {
        if(_amount == 0) revert InvalidParamsZeroValue();
        if(_amount > maxMintAmount) revert MaxMintAmount();
        if(_paymentTokenAddress == address(0)) revert InvalidParamsZeroAddress();
        if(fixedExchangeRate[_paymentTokenAddress] == 0) revert InvalidParamsZeroValue();

        address _to = _msgSender();
        uint256 _price = fixedExchangeRate[_paymentTokenAddress]*_amount;
        IERC20Metadata _paymentToken = IERC20Metadata(_paymentTokenAddress);

        if(_paymentToken.allowance(_to, address(this)) < _price) revert Underpaid();
        _paymentToken.safeTransferFrom(_to, address(this), _price);
        Energy(energyToken).mint(_to, _amount);

        emit Mint(_to, _amount, _paymentTokenAddress, _price);
    }

    /**
     * Minting with dynamic exchange rate (HDAO, BAL, AAVE, etc.).
     * Sent tokens will be exchanged for WETH and then for USDC and HDAO.
     * 
     * @param _amount to be minted
     * @param _paymentTokenAddress to be used for payment
     * @param _offlinePrice provided by an offline Oracle
     * @param _signature that proves the Oracle's price data was provided by the owner
     */
    function mintWithDynamic(uint256 _amount, address _paymentTokenAddress, uint256 _offlinePrice, bytes memory _signature)
        public 
        nonReentrant
    {
        if(_amount == 0) revert InvalidParamsZeroValue();
        if(_amount > maxMintAmount) revert MaxMintAmount();
        if(_paymentTokenAddress == address(0)) revert InvalidParamsZeroAddress();
        if(dynamicExchangeTokens[_paymentTokenAddress] == bytes32(0)) revert InvalidParamsZeroValue();

        address _to = _msgSender();

        // Verify the signature
        bytes32 _hash = keccak256(abi.encodePacked(_offlinePrice));
        bytes32 _ethMessageHash = MessageHashUtils.toEthSignedMessageHash(_hash);
        bool validSignature = SignatureChecker.isValidSignatureNow(trustedSigner, _ethMessageHash, _signature);
        if(!validSignature) revert InvalidSignature();

        // Ask Balancer for a price quote of TOKEN/ETH and for ETH/USDC so we can know the current TOKEN USDC price from balancer.
        uint256 _price = getPrice(_amount, _paymentTokenAddress);

        // Compare the price with the provided as "offchain" price, if deviates, abort
        uint256 deviation = _price*dynamicExchangeAcceptedDeviationPercentage/100;
        if(_price+deviation < _offlinePrice 
            || _price-deviation > _offlinePrice) revert UnacceptablePriceDeviation();

        // Transfer to the _price of _paymentToken and mint
        IERC20Metadata(_paymentTokenAddress).safeTransferFrom(_to, address(this), _price);
        Energy(energyToken).mint(_to, _amount);

        _swapPaymentTokenToHDAOAndUSDC(_price, _paymentTokenAddress);

        emit Mint(_to, _amount, _paymentTokenAddress, _price);
    }

    /**
     * Burns the desired ENRG amount, receiving the desired payment token in exchange (if available).
     * 
     * @param _amount ENRG to be burned
     * @param _paymentTokenAddress token to receive as payment
     */
    function burn(uint256 _amount, address  _paymentTokenAddress) public virtual nonReentrant{
        if(_amount == 0) revert InvalidParamsZeroValue();
        if(_paymentTokenAddress == address(0)) revert InvalidParamsZeroAddress();
        if(fixedExchangeRate[_paymentTokenAddress] == 0) revert InvalidParamsZeroValue();

        address _from = _msgSender();
        uint256 _price = fixedExchangeRate[_paymentTokenAddress]*_amount;
        IERC20Metadata _paymentToken = IERC20Metadata(_paymentTokenAddress);
        if(_paymentToken.balanceOf(address(this)) < _price) revert NotEnoughFunds();

        Energy(energyToken).burn(_from, _amount);
        _paymentToken.safeTransfer(_from, _price);

        emit Burn(_from, _amount, _paymentTokenAddress, _price);
    }

    /**
     * Lets the contract owner to withdraw any ERC20 token from the contract.
     * 
     * @param _erc20 token to withdraw
     */
    function withdraw(address _erc20) 
        public 
        onlyOwner
        nonReentrant
    {       
        IERC20Metadata _withdrawToken = IERC20Metadata(_erc20);
        uint _balance = _withdrawToken.balanceOf(address(this));

        _withdrawToken.safeTransfer(owner(), _balance);

        emit Withdrawal(_balance, _erc20, block.timestamp);
    }

    /**
     * Calculates the price for the amount of ENRG in the payment token.
     * Can be used from any external actor to calculate the price before minting.
     * 
     * @param _amount of energy to be minted
     * @param _paymentTokenAddress to be used for payment
     */
    function getPrice(uint256 _amount, address _paymentTokenAddress)
        public 
        returns (uint256)
    {
        if(_amount == 0) revert InvalidParamsZeroValue();
        if(_paymentTokenAddress == address(0)) revert InvalidParamsZeroAddress();
        if(dynamicExchangeTokens[_paymentTokenAddress] == bytes32(0)) revert InvalidParamsZeroValue();

        uint8 decimals = IERC20Metadata(_paymentTokenAddress).decimals();
        uint256 _tokenPrice = _getSwapPrice(1 * 10**decimals, dynamicExchangeTokens[_paymentTokenAddress], _paymentTokenAddress, WETH_TOKEN_ADDRESS);
        uint256 _ethPrice = _getSwapPrice(1 * 10**18, USDCWETH_POOLID, WETH_TOKEN_ADDRESS, USDC_TOKEN_ADDRESS) * 10**12; // USDC has only 6 decimals, we need to add some 0s
        uint256 _tokenUSDCPrice = (_tokenPrice*_ethPrice) / 10**18;

        return  (_amount * USDC_PRICE / _tokenUSDCPrice) * 10**18;
    }

    /**
     * Get the swap amount (amount of tokenOut we we'll get with the provided tokenIn) from a Balancer pool.
     * 
     * @param _amount of the tokenIn
     * @param _poolId to look at
     * @param _tokenIn to be swaped
     * @param _tokenOut to be received
     */
    function _getSwapPrice(uint256 _amount, bytes32 _poolId, address _tokenIn, address _tokenOut)
        private
        returns (uint256)
    {       
        if(_amount == 0) revert InvalidParamsZeroValue();
        if(_poolId == bytes32(0)) revert InvalidParamsZeroValue();
        if(_tokenIn == address(0)) revert InvalidParamsZeroAddress();
        if(_tokenOut == address(0)) revert InvalidParamsZeroAddress();

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

    /**
     * Swaps the totalAmount of tokens to HDAO and USDC (depending on the case)
     * 
     * @param _totalAmount of tokens to swap
     * @param _token address
     */
    function _swapPaymentTokenToHDAOAndUSDC(uint256 _totalAmount, address _token)
        private
    {
        if(_totalAmount == 0) revert InvalidParamsZeroValue();
        
        // Swap some (77%, $2 for every $2.6) $HDAO to USDC
        uint256 _amount = _totalAmount*77/100;

        if(_token != HDAO_TOKEN_ADDRESS){
            _swapPaymentTokens(_totalAmount-_amount, _token, HDAO_TOKEN_ADDRESS, HDAOWETH_POOLID);
        }

        _swapPaymentTokens(_amount, _token, USDC_TOKEN_ADDRESS, USDCWETH_POOLID);
    }

    /**
     * Swap tokens using Balancer.
     * It first exchange the token for WETH and then for the desired assetOut.
     * 
     * @param _amount of tokens to swap
     * @param _paymentToken is the initial token to be swapped
     * @param _assetOut token to be swapped into
     * @param _poolOut (WETH-AssetOut Balancer pool id)
     */
    function _swapPaymentTokens(uint256 _amount, address _paymentToken, address _assetOut, bytes32 _poolOut)
        private
        returns (int256[] memory)
    {
        IERC20Metadata(_paymentToken).approve(address(BalancerVault), _amount);

        IVault.BatchSwapStep[] memory _swaps = new IVault.BatchSwapStep[](2);
        _swaps[0] = IVault.BatchSwapStep({
            poolId: dynamicExchangeTokens[_paymentToken],
            assetInIndex: 0,
            assetOutIndex: 1,
            amount: _amount,
            userData: new bytes(0)
        });
        _swaps[1] = IVault.BatchSwapStep({
            poolId: _poolOut,
            assetInIndex: 1,
            assetOutIndex: 2,
            amount: 0,
            userData: new bytes(0)
        });

        IAsset[] memory _assets = new IAsset[](3);
        _assets[0] = IAsset(_paymentToken);
        _assets[1] = IAsset(WETH_TOKEN_ADDRESS);
        _assets[2] = IAsset(_assetOut);

        IVault.FundManagement memory _funds = IVault.FundManagement({
            sender: address(this),
            fromInternalBalance: false,
            recipient: payable(address(this)),
            toInternalBalance: false
        });

        int256[] memory _limits = new int256[](3);
        _limits[0] = type(int256).max;
        _limits[1] = type(int256).max;
        _limits[2] = type(int256).max;

        return BalancerVault.batchSwap(
            IVault.SwapKind.GIVEN_IN,
            _swaps,
            _assets,
            _funds,
            _limits,
            type(uint256).max
        );
    }
}