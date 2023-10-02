// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./DexTool.sol";

contract Energy is ERC20, Pausable, Ownable {
    using SafeERC20 for IERC20;
    mapping (address => uint) public fixedExchangeRate; // token address => exchange rate (? token = 1 ENRG)
    address[] public fixedExchangeTokens;

    address public dexTool;
    address public oraclePaymentToken;
    uint128 public oracleTokenMintPrice;
    uint128 public tokenReplenishPrice;
    bool public autoReplenish;

    error InvalidParams();
    error Underpaid();
    error NotEnoughFunds();
    error OraclePaymentTokenDisabled();

    event Mint(address indexed _to, uint256 _amount, address indexed _paymentToken, uint256 _price);
    event Burn(address indexed _from, uint256 _amount, address indexed _paymentToken, uint256 _price);
    event Withdrawal(uint amount, address erc20, uint when);

    constructor(
        address _dexTool,
        address _oraclePaymentToken,
        uint128 _oracleTokenMintPrice, // $2.6 in tokenB = 1 ENRG
        uint128 _tokenReplenishPrice,  // $2
        address[] memory _fixedExchangeTokens, 
        uint256[] memory _fixedExchangeRates) 
        ERC20("Energy", "ENRG") 
    {
        setOracle(_dexTool, _oraclePaymentToken, _oracleTokenMintPrice);
        setFixedExchangeRates(_fixedExchangeTokens, _fixedExchangeRates);
        setAutoReplenish(true, _tokenReplenishPrice);
    }

    function decimals() public view virtual override returns (uint8) {
        return 1;
    }

    function setOracle(address _oracle, address _oraclePaymentToken, uint128 _oracleTokenMintPrice) 
        public 
        onlyOwner 
    {
        // Setting _oraclePaymentToken to address(0) disables oracle payment
        if(_oracle == address(0)) revert InvalidParams();
        if(_oracleTokenMintPrice <= 0) revert InvalidParams();

        dexTool = _oracle;
        oraclePaymentToken = _oraclePaymentToken;
        oracleTokenMintPrice = _oracleTokenMintPrice;
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

    function setAutoReplenish(bool _autoReplenish, uint128 _tokenReplenishPrice) 
        public 
        onlyOwner 
    {
        if(_tokenReplenishPrice == 0) revert InvalidParams();

        autoReplenish = _autoReplenish;
        tokenReplenishPrice = _tokenReplenishPrice;
    }

    function getFixedExchangeTokensBalances()
        public
        view
        returns (address[] memory, uint256[] memory)
    {
        uint256[] memory _balances = new uint256[](fixedExchangeTokens.length);

        for(uint8 i = 0; i < fixedExchangeTokens.length; i++) {
            IERC20 _token = IERC20(fixedExchangeTokens[i]);
            _balances[i] = _token.balanceOf(address(this));
        }

        return (fixedExchangeTokens, _balances);
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
        if(fixedExchangeRate[_paymentToken] == 0 && _paymentToken != oraclePaymentToken) revert InvalidParams();

        uint256 _price = 0;
        if(_paymentToken == oraclePaymentToken){
            _price = getMintPriceWithOracle(uint128(_amount));
        }else{
            _price = fixedExchangeRate[_paymentToken]*_amount;
        }

        IERC20 paymentToken = IERC20(_paymentToken);
        if(paymentToken.allowance(_msgSender(), address(this)) < _price) revert Underpaid();
        paymentToken.transferFrom(_msgSender(), address(this), _price);

        _mint(_to, _amount);

        if(_paymentToken == oraclePaymentToken && autoReplenish){
            // _replenish(_amount);
        }
        
        emit Mint(_to, _amount, _paymentToken, _price);
    }

    function getMintPriceWithOracle(uint128 _amount)
        public
        view
        returns (uint256)
    {
        if(_amount == 0) revert InvalidParams();
        if(oraclePaymentToken == address(0)) revert OraclePaymentTokenDisabled();
        return DexTool(dexTool).estimateAmountOut(oraclePaymentToken, _amount*oracleTokenMintPrice);
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
        if(fixedExchangeRate[_paymentTokenAddress] == 0) revert InvalidParams();

        uint256 _price = fixedExchangeRate[_paymentTokenAddress]*_amount;
        IERC20 _paymentToken = IERC20(_paymentTokenAddress);
        if(_paymentToken.balanceOf(address(this)) < _price) revert NotEnoughFunds();

        _burn(_msgSender(), _amount);
        _paymentToken.transfer(_msgSender(), _price);

        emit Burn(_msgSender(), _amount, _paymentTokenAddress, _price);
    }

    // function _replenish(uint256 _amount) 
    //     internal
    //     returns (uint256)
    // {
    //     if(_amount == 0) revert InvalidParams();
    //     if(tokenReplenishPrice == 0) revert InvalidParams();

    //     uint256 _amountInputMax = 0;
    //     return DexTool(dexTool).swapExactOutputSingle(_amount*tokenReplenishPrice, _amountInputMax);
    // }

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