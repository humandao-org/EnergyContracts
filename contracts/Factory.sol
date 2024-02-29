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

    // Sepolia
    // address immutable HDAO_TOKEN_ADDRESS = 0x10e6f5debFd4A66A1C1dDa6Ba68CfAfcC879eab2;
    // address immutable USDC_TOKEN_ADDRESS = 0x23e259cFf0404d90FCDA231eDE0c350fb509bDd7;
    // address immutable WETH_TOKEN_ADDRESS = 0x303d53087ABBbe343e2360BB288275Ddba47A6b6;
    // bytes32 immutable USDCWETH_POOLID = 0x20f69a6fe6b518423c6d78845daa36770e5ed3fa000200000000000000000059;
    // bytes32 immutable HDAOWETH_POOLID = 0xc59df746f926663744ab3d10f9e71dc87a2f94e000020000000000000000005b;
    // IBalancerQueries immutable BalancerQueries = IBalancerQueries(0x1802953277FD955f9a254B80Aa0582f193cF1d77);

    // Polygon
    address immutable HDAO_TOKEN_ADDRESS = 0x72928d5436Ff65e57F72D5566dCd3BaEDC649A88;
    address immutable USDC_TOKEN_ADDRESS = 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174;
    address immutable WETH_TOKEN_ADDRESS = 0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619;
    bytes32 immutable USDCWETH_POOLID = 0x03cd191f589d12b0582a99808cf19851e468e6b500010000000000000000000a;
    bytes32 immutable HDAOWETH_POOLID = 0xb53f4e2f1e7a1b8b9d09d2f2739ac6753f5ba5cb000200000000000000000137;
    IBalancerQueries immutable BalancerQueries = IBalancerQueries(0xE39B5e3B6D74016b2F6A9673D7d7493B6DF549d5);

    
    IVault immutable BalancerVault = IVault(0xBA12222222228d8Ba445958a75a0704d566BF2C8);
    uint256 immutable USDC_PRICE = 25 * 10**5;

    address public trustedSigner;
    address public energyToken;
    uint256 public maxMintAmount;
    mapping (address => uint) public fixedExchangeRate; // token address => exchange rate (? token = 1 ENRG)
    mapping (address => bytes32) public dynamicExchangeTokens; // token address => WETH-Token Balancer pool id
    mapping (address => bytes32) public stableExchangeTokens; // token address => WETH-Token Balancer pool id
    address[] public fixedExchangeTokens;
    uint8 public dynamicExchangeAcceptedDeviationPercentage;
    uint256 public burningPrice; // Fixed burning price (without decimals!) to be paid in the burning
    address public recipientAddress; //Address where we transfer the stablecoins

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
    error InvalidAmount(string message);

    event Mint(address indexed _to, uint256 _amount, address indexed _paymentToken, uint256 _price);
    event Burn(address indexed _from, uint256 _amount, address indexed _paymentToken, uint256 _price);
    event Withdrawal(uint amount, address erc20, uint when);
    event Price(uint amount, address paymentAddress, uint price);
    event Migration(address indexed stablecoin, address indexed to, uint256 amount);

    constructor(
        address _initialOwner, 
        address _energyToken,
        address _recipientAddress,
        uint256 _maxMint,
        address[] memory _fixedExchangeTokens, 
        uint256[] memory _fixedExchangeRates,
        address[] memory _dynamicExchangeTokens,
        bytes32[] memory _dynamicExchangePools,
        address[] memory _stableExchangeTokens,
        bytes32[] memory _stableExchangePools
    )
        Ownable(_initialOwner)
    {
        energyToken = _energyToken;
        setMaxMintAmount(_maxMint);
        setFixedExchangeRates(_fixedExchangeTokens, _fixedExchangeRates);
        setDynamicExchangeTokens(_dynamicExchangeTokens, _dynamicExchangePools);
        dynamicExchangeAcceptedDeviationPercentage = 10;
        trustedSigner = _initialOwner;
        burningPrice = 2;
        recipientAddress = _recipientAddress;
        setStableExchangeTokens(_stableExchangeTokens, _stableExchangePools);
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
     * Set the stablecoins that can be used for minting
     * 
     * @param _fixedExchangeTokens array of token addresses
     * @param _fixedExchangeRates array of Balancer pool ids (WETH-Token pools)
     */
    function setFixedExchangeTokens(address[] memory _fixedExchangeTokens, uint256[] memory _fixedExchangeRates) 
        public 
        onlyOwner 
    {
        if(_fixedExchangeTokens.length == 0) revert InvalidParamsLength();
        if(_fixedExchangeRates.length == 0) revert InvalidParamsLength();
        if(_fixedExchangeRates.length != _fixedExchangeTokens.length) revert InvalidParamsLength();

        fixedExchangeTokens = _fixedExchangeTokens;

        for(uint8 i = 0; i < _fixedExchangeTokens.length; i++) {
            if(_fixedExchangeTokens[i] == address(0)) revert InvalidParamsZeroAddress();
            if(_fixedExchangeRates[i] == 0) revert InvalidParamsZeroValue();
            fixedExchangeRate[_fixedExchangeTokens[i]] = _fixedExchangeRates[i];
        }
    }

    /**
     * Sets the recipientAddress (20% fee)
     * 
     * @param _newRecipientAddress target recipient address
     */
    function setRecipientAddress(address _newRecipientAddress) 
        public 
        onlyOwner
    {
        if(_newRecipientAddress == address(0)) revert InvalidParamsZeroAddress();
        recipientAddress = _newRecipientAddress;
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
     * Set the tokens that can be used for minting, with a dynamic exchange rate, from a Balancer pool.
     * 
     * @param _stableExchangeTokens array of token addresses
     * @param _stableExchangePools array of Balancer pool ids (WETH-Token pools)
     */
    function setStableExchangeTokens(address[] memory _stableExchangeTokens, bytes32[] memory _stableExchangePools) 
        public 
        onlyOwner 
    {
        if(_stableExchangeTokens.length == 0) revert InvalidParamsLength();
        if(_stableExchangePools.length == 0) revert InvalidParamsLength();
        if(_stableExchangeTokens.length != _stableExchangePools.length) revert InvalidParamsLength();

        for(uint8 i = 0; i < _stableExchangeTokens.length; i++) {
            if(_stableExchangeTokens[i] == address(0)) revert InvalidParamsZeroAddress();
            if(_stableExchangePools[i] == 0) revert InvalidParamsZeroValue();
            stableExchangeTokens[_stableExchangeTokens[i]] = _stableExchangePools[i];
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

    function setBurningPrice(uint256 _burningPrice) 
        public 
        onlyOwner 
    {
        if(_burningPrice == 0) revert InvalidParamsZeroValue();

        burningPrice = _burningPrice;
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
        if(_amount < 5) revert InvalidAmount("Amount must be at least 0.05 ENRG");
        if(_amount > maxMintAmount) revert MaxMintAmount(); // 3000 ENRG in integer terms
        if(_amount % 5 != 0) revert InvalidAmount("Amount must be divisible by 5");

        if(_paymentTokenAddress == address(0)) revert InvalidParamsZeroAddress();
        if(fixedExchangeRate[_paymentTokenAddress] == 0) revert InvalidParamsZeroValue();
        
        IERC20Metadata _paymentToken = IERC20Metadata(_paymentTokenAddress);

        address _to = _msgSender();
        uint256 _price = fixedExchangeRate[_paymentTokenAddress] * _amount;
        uint256 _priceToEnrg = (_price * 80) / 100; // 80% of _price
        uint256 _priceToHdao = _price - _priceToEnrg; // Remaining 20%

            
        // Check if allowance is sufficient
        uint256 allowed = _paymentToken.allowance(_to, address(this));
        if(allowed < _price/(10**2)) { revert("Underpaid");}

        // Should only proceed if transfer was successful
        _paymentToken.safeTransferFrom(_to, address(this), _price / (10**2));

        //Swap 20% to hdao and check for success
        // _swapStablePaymentTokens(_priceToHdao /10**2, _paymentTokenAddress, HDAO_TOKEN_ADDRESS, HDAOWETH_POOLID);

        // Now mint energy
        Energy(energyToken).mint(_to, _amount);
        //transfer 20% to designated address
        _paymentToken.transfer(recipientAddress, _priceToHdao /(10**2));
        
        //Log event to transaction
        emit Mint(_to, _amount, _paymentTokenAddress, _price /(10 ** 2));
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
        if(_amount < 5) revert InvalidAmount("Amount must be at least 0.05 ENRG");
        if(_amount % 5 != 0) revert InvalidAmount("Amount must be divisible by 5");
        if(_paymentTokenAddress == address(0)) revert InvalidParamsZeroAddress();
        if(dynamicExchangeTokens[_paymentTokenAddress] == bytes32(0) && _paymentTokenAddress != WETH_TOKEN_ADDRESS) revert InvalidParamsZeroValue();

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


        if(_paymentTokenAddress == WETH_TOKEN_ADDRESS){
            _swapPaymentWETHtoUSDCandTransfer(_price);
        } else {
            _swapPaymentTokenToUSDCAndTransfer(_price, _paymentTokenAddress);
        }
        // Calculate the total USDC amount from ENRG, considering 1 ENRG = 2.5 USD, and adjust for decimals.
        uint256 usdcAmount = _amount * 25 * 10**4 / 100; // Simplify the calculation

        // Calculate 20% of the USDC amount
        uint256 twentyPercentUsdc = usdcAmount * 20 / 10;
        
        IERC20Metadata(USDC_TOKEN_ADDRESS).transfer(recipientAddress, twentyPercentUsdc);


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

        address _from = _msgSender();
        IERC20Metadata _paymentToken = IERC20Metadata(_paymentTokenAddress);
        uint256 _price = burningPrice*_amount*10**_paymentToken.decimals()/10**Energy(energyToken).decimals();
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
     * Migrates the entire balance of each supported stablecoin to a new contract address.
     * This function is intended to be used in the event of contract upgrades.
     * @param _newContract The address of the new contract to transfer the stablecoin balances to.
     */
    function migrate(address _newContract) external onlyOwner nonReentrant {
        require(_newContract != address(0), "Invalid address");

        for (uint i = 0; i < fixedExchangeTokens.length; i++) {
            address stablecoin = fixedExchangeTokens[i];
            uint256 balance = IERC20(stablecoin).balanceOf(address(this));

            if (balance > 0) {
                bool success = IERC20(stablecoin).transfer(_newContract, balance);
                require(success, "Transfer failed");
                emit Migration(stablecoin, _newContract, balance);
            }
        }
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

        uint8 decimals = IERC20Metadata(_paymentTokenAddress).decimals();

        uint256 _ethPrice = _getSwapPrice(1 * 10**18, USDCWETH_POOLID, WETH_TOKEN_ADDRESS, USDC_TOKEN_ADDRESS) * 10**12; // USDC has only 6 decimals, we need to add some 0s
        uint256 _tokenUSDCPrice = _ethPrice;

        if(_paymentTokenAddress != WETH_TOKEN_ADDRESS){ // If the payment token is not WETH, we need to calculate the price
            if(dynamicExchangeTokens[_paymentTokenAddress] == bytes32(0)) revert InvalidParamsZeroValue();
            uint256 _tokenPrice = _getSwapPrice(1 * 10**decimals, dynamicExchangeTokens[_paymentTokenAddress], _paymentTokenAddress, WETH_TOKEN_ADDRESS);
            _tokenUSDCPrice = (_tokenPrice*_ethPrice) / 10**18;
            return  ((((_amount*10**16) * (USDC_PRICE*10**12))/10**18) / _tokenUSDCPrice)*10**18;
        }
        return (_amount * (USDC_PRICE*10**12) * 10**16) / _tokenUSDCPrice;
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
    function _swapPaymentTokenToUSDCAndTransfer(uint256 _totalAmount, address _token)
        private
    {
        if(_totalAmount == 0) revert InvalidParamsZeroValue();

        _swapDynamicPaymentTokens(_totalAmount, _token, USDC_TOKEN_ADDRESS, USDCWETH_POOLID);
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
    function _swapDynamicPaymentTokens(uint256 _amount, address _paymentToken, address _assetOut, bytes32 _poolOut)
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

        /**
     * Swap tokens using Balancer.
     * It first exchanges the stable coins to weth then the target asset _assetOut
     * 
     * @param _amount of tokens to swap
     * @param _paymentToken is the initial token to be swapped
     * @param _assetOut token to be swapped into
     * @param _poolOut (WETH-AssetOut Balancer pool id)
     */
    function _swapStablePaymentTokens(uint256 _amount, address _paymentToken, address _assetOut, bytes32 _poolOut)
        private
        returns (int256[] memory)
    {
        IERC20Metadata(_paymentToken).approve(address(BalancerVault), _amount);

        IVault.BatchSwapStep[] memory _swaps = new IVault.BatchSwapStep[](2);
        _swaps[0] = IVault.BatchSwapStep({
            poolId: stableExchangeTokens[_paymentToken],
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

    /**
     * Swaps the totalAmount of WETH to USDC
     * 
     * @param _totalAmount of WETH to swap
     */
    function _swapPaymentWETHtoUSDCandTransfer(uint256 _totalAmount)
        private
    {
        if(_totalAmount == 0) revert InvalidParamsZeroValue();

        // Swap some (80%, $2 for every $2.5) $HDAO to USDC
        address _token = WETH_TOKEN_ADDRESS;

        IVault.FundManagement memory _funds = IVault.FundManagement({
            sender: address(this),
            fromInternalBalance: false,
            recipient: payable(address(this)),
            toInternalBalance: false
        });

        IERC20Metadata(_token).approve(address(BalancerVault), _totalAmount);

        BalancerVault.swap(IVault.SingleSwap({
            poolId: USDCWETH_POOLID,
            kind: IVault.SwapKind.GIVEN_IN,
            assetIn: IAsset(_token),
            assetOut: IAsset(USDC_TOKEN_ADDRESS),
            amount: _totalAmount,
            userData: new bytes(0)
        }), _funds, 0, type(uint256).max);
    }
}
