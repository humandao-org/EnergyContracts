//SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import "@uniswap/v3-periphery/contracts/libraries/OracleLibrary.sol";
import '@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol';
import "./IERC20_07.sol";
import "./DexTool.sol";

contract UniswapV3 is DexTool {
    IUniswapV3Factory public factory;
    ISwapRouter public immutable swapRouter;
    address public owner;
    address public tokenA;
    address public tokenB;
    uint24 public fee;
    uint32 public twapDuration;
    uint128 public tokenBMintPrice;
    address public pool;


    constructor(
        address _factory,
        address _swapRouter,
        address _tokenA,        // USDC
        address _tokenB,        // HDAO
        uint24  _fee,           // 3000
        uint32 _twapDuration    // 30 minutes
    ){
        require(_factory != address(0), "IPF");

        owner = msg.sender;
        factory = IUniswapV3Factory(_factory);
        swapRouter = ISwapRouter(_swapRouter);
        setProperties(_tokenA, _tokenB, _fee, _twapDuration);
    }

    function setOwner(address _owner) 
        public 
        onlyOwner 
    {
        require(_owner != address(0), "IPO");
        owner = _owner;
    }

    function setProperties(address _tokenA, address _tokenB, uint24 _fee, uint32 _twapDuration)
        public
        onlyOwner
    {
        require(_tokenA != address(0), "IPA");
        require(_tokenB != address(0), "IPB");
        require(_fee > 0, "IPF");
        require(_twapDuration > 0, "IPT");

        tokenA = _tokenA;
        tokenB = _tokenB;
        fee = _fee;
        twapDuration = _twapDuration;
        pool = factory.getPool(tokenA, tokenB, fee);
    }

    function estimateAmountOut(address _tokenOut, uint128 _amount) 
        override
        external 
        view 
        returns (uint256) 
    {
        require(_tokenOut == tokenA || _tokenOut == tokenB, "IPT");
        require(_amount > 0, "IPA");

        (int24 _tick, ) = OracleLibrary.consult(pool, twapDuration);

        address _tokenIn = _tokenOut == tokenA ? tokenB : tokenA;

        return OracleLibrary.getQuoteAtTick(_tick, _amount, _tokenIn, _tokenOut);
    }


    // Swaps a minimum possible amount of tokenB for a fixed amount of tokenA. (HDAO => USDC)
    function swapExactOutputSingle(uint256 _amountOut, uint256 _amountInMaximum)
        override
        external 
        returns (uint256 _amountIn) 
    {
        require(_amountOut > 0, 'IPA');
        require(_amountInMaximum > 0, 'IPB');

        address _tokenIn = tokenB;

        (bool success, bytes memory data) = _tokenIn.call(abi.encodeWithSelector(IERC20_07.transferFrom.selector, msg.sender, address(this), _amountInMaximum));
        require(success && (data.length == 0 || abi.decode(data, (bool))), 'STF');

        (success, data) = _tokenIn.call(abi.encodeWithSelector(IERC20_07.approve.selector, address(swapRouter), _amountInMaximum));
        require(success && (data.length == 0 || abi.decode(data, (bool))), 'SA');

        ISwapRouter.ExactOutputSingleParams memory params =
            ISwapRouter.ExactOutputSingleParams({
                tokenIn: _tokenIn,
                tokenOut: tokenA,
                fee: fee,
                recipient: msg.sender,
                deadline: block.timestamp,
                amountOut: _amountOut,
                amountInMaximum: _amountInMaximum,
                sqrtPriceLimitX96: 0
            });

        // Executes the swap returning the amountIn needed to spend to receive the desired amountOut.
        _amountIn = swapRouter.exactOutputSingle(params);

        // For exact output swaps, the amountInMaximum may not have all been spent.
        // If the actual amount spent (amountIn) is less than the specified maximum amount, we must refund the msg.sender and approve the swapRouter to spend 0.
        if (_amountIn < _amountInMaximum) {
            (success, data) = _tokenIn.call(abi.encodeWithSelector(IERC20_07.approve.selector, address(swapRouter), 0));
            require(success && (data.length == 0 || abi.decode(data, (bool))), 'SA');

            (success, data) = _tokenIn.call(abi.encodeWithSelector(IERC20_07.transfer.selector, msg.sender, _amountInMaximum - _amountIn));
            require(success && (data.length == 0 || abi.decode(data, (bool))), 'ST');
        }
    }

    modifier onlyOwner() {
        require(owner == msg.sender, "O");
        _;
    }
}