//SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import "@uniswap/v3-periphery/contracts/libraries/OracleLibrary.sol";
import "./Oracle.sol";

contract UniswapV3Twap is Oracle {
    IUniswapV3Factory factory;
    address tokenA;
    address tokenB;
    uint24 fee;
    uint32 twapDuration;
    uint128 tokenBMintPrice;
    address pool;

    constructor(
        address _factory,
        address _tokenA,        // USDC
        address _tokenB,        // HDAO
        uint24  _fee,           // 3000
        uint32 _twapDuration    // 30 minutes
    ){
        require(_factory != address(0), "Invalid factory");

        factory = IUniswapV3Factory(_factory);
        setProperties(_tokenA, _tokenB, _fee, _twapDuration);
    }

    function setProperties(address _tokenA, address _tokenB, uint24 _fee, uint32 _twapDuration)
        public 
    {
        require(_tokenA != address(0), "Invalid tokenA");
        require(_tokenB != address(0), "Invalid tokenB");
        require(_fee > 0, "Invalid fee");
        require(_twapDuration > 0, "Invalid twapDuration");

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
        returns (uint256 amountOut) 
    {
        require(_tokenOut == tokenA || _tokenOut == tokenB, "Not a valid tokenOut");

        (int24 _tick, ) = OracleLibrary.consult(pool, twapDuration);

        address _tokenIn = _tokenOut == tokenA ? tokenB : tokenA;

        amountOut = OracleLibrary.getQuoteAtTick(_tick, _amount, _tokenIn, _tokenOut);
    }
}