import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { IERC20Metadata, UniswapV3Twap } from "../typechain-types";

const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const WETH_ADDRESS = '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619';
const UNISWAP_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984"
const TOKEN_A = USDC_ADDRESS
const TOKEN_B = WETH_ADDRESS
const FEE = 3000 // 0.3%

let uniswapV3Twap: UniswapV3Twap;

describe("UniswapV3Twap", () => {
    async function deployFixture() {
        const [owner, alice, bob] = await ethers.getSigners();

        // Deploying Oracle
        const contractFactory = await ethers.getContractFactory("UniswapV3Twap");
        uniswapV3Twap = await contractFactory.deploy(
            UNISWAP_FACTORY,
            TOKEN_A,
            TOKEN_B,
            FEE,
            30*60 // 30 minutes twap duration
        );
        await uniswapV3Twap.waitForDeployment();

        return { uniswapV3Twap, owner, alice, bob };
    }

    describe("Deployment & Admin", () => {
        it("Should be a proper address, and owner", async () => {
            const { uniswapV3Twap } = await loadFixture(deployFixture);
            expect(await uniswapV3Twap.getAddress()).to.be.a.properAddress;
        });
    });

    describe("Oracle", () => {
        it("Get price", async () => {
            const { uniswapV3Twap } = await loadFixture(deployFixture);

            const tokenIn = TOKEN_A; // USDC to WETH
            const tokenOut = TOKEN_B;
            const tokenInContract: IERC20Metadata = await ethers.getContractAt("IERC20Metadata", tokenIn);
            const tokenOutContract: IERC20Metadata = await ethers.getContractAt("IERC20Metadata", tokenOut);
            const tokenInDecimals: bigint = await tokenInContract.decimals();
            const tokenOutDecimals: bigint = await tokenOutContract.decimals();

            const amount: bigint = BigInt(1600) * (BigInt(10) ** tokenInDecimals);
            const price: bigint = await uniswapV3Twap.estimateAmountOut(tokenOut, amount)

            // console.log('price: ', ethers.formatUnits(price, tokenOutDecimals));
            expect(price).to.be.greaterThan(0);
        })
    });
})