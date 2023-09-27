import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers, network } from "hardhat";
import { IERC20Metadata, UniswapV3 } from "../typechain-types";

const BINANCE_WALLET_ADDRESS = '0xf977814e90da44bfa03b6295a0616a897441acec'; // This might stop working at some point (if they move their funds)
const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const WETH_ADDRESS = '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619';
const UNISWAP_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
const UNISWAP_SWAP_ROUTER = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
const TOKEN_A = USDC_ADDRESS
const TOKEN_B = WETH_ADDRESS
const FEE = 3000 // 0.3%

let uniswapV3: UniswapV3;
let usdcContract: IERC20Metadata;
let wethContract: IERC20Metadata;

describe("UniswapV3", async () => {
    before(async () => {
        await network.provider.request({
            method: "hardhat_reset", 
            params: [{
                forking: { jsonRpcUrl: 'https://polygon-mainnet.g.alchemy.com/v2/' + process.env.ALCHEMY_TOKEN }
            }]
        });
    });

    async function deployFixture() {
        const [owner, alice, bob] = await ethers.getSigners();

        usdcContract = await ethers.getContractAt("IERC20Metadata", USDC_ADDRESS);
        wethContract = await ethers.getContractAt("IERC20Metadata", WETH_ADDRESS);

        // Deploying Oracle
        const contractFactory = await ethers.getContractFactory("UniswapV3");
        uniswapV3 = await contractFactory.deploy(
            UNISWAP_FACTORY,
            UNISWAP_SWAP_ROUTER,
            TOKEN_A,
            TOKEN_B,
            FEE,
            30*60 // 30 minutes twap duration
        );
        await uniswapV3.waitForDeployment();

        // Get some USDC and USDT from Binance :p
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [BINANCE_WALLET_ADDRESS],
        });
        const binanceSigner = await ethers.getSigner(BINANCE_WALLET_ADDRESS);
        const wethAmount: bigint = BigInt(100) * BigInt(10)**await wethContract.decimals(); // 100 WETH
        const usdcAmount: bigint = BigInt(100000) * BigInt(10)**await usdcContract.decimals(); // 100000 USDC
        await usdcContract.connect(binanceSigner).transfer(owner.address, usdcAmount)
        await wethContract.connect(binanceSigner).transfer(owner.address, wethAmount)
        expect(await usdcContract.balanceOf(owner.address)).to.be.equal(usdcAmount);
        expect(await wethContract.balanceOf(owner.address)).to.be.equal(wethAmount);

        return { uniswapV3, owner, alice, bob };
    }

    describe("Deployment & Admin", () => {
        it("Should be a proper address", async () => {
            const { uniswapV3, owner } = await loadFixture(deployFixture);
            expect(await uniswapV3.getAddress()).to.be.a.properAddress;
            expect(await uniswapV3.owner()).to.be.equal(owner.address);
        });

        it("Should be able to change its owner", async () => {
            const { uniswapV3, owner, alice } = await loadFixture(deployFixture);
            await uniswapV3.setOwner(alice.address);
            expect(await uniswapV3.owner()).to.be.equal(alice.address);

            // ERRORS
            await expect(uniswapV3.setOwner(owner.address)).to.be.revertedWith("O");
            await expect(uniswapV3.connect(alice).setOwner(ethers.ZeroAddress)).to.be.revertedWith("IPO");
        })

        it("Should be able to change its properties", async () => {
            const { uniswapV3, owner, alice } = await loadFixture(deployFixture);

            await uniswapV3.setProperties(TOKEN_B, TOKEN_A, FEE*2, 60*60);
            expect(await uniswapV3.tokenA()).to.be.equal(TOKEN_B);
            expect(await uniswapV3.tokenB()).to.be.equal(TOKEN_A);
            expect(await uniswapV3.fee()).to.be.equal(FEE*2);
            expect(await uniswapV3.twapDuration()).to.be.equal(60*60);

            // ERRORS
            await expect(uniswapV3.connect(alice).setProperties(TOKEN_B, TOKEN_A, FEE*2, 60*60)).to.be.revertedWith("O");
            await expect(uniswapV3.setProperties(ethers.ZeroAddress, TOKEN_A, FEE*2, 60*60)).to.be.revertedWith("IPA");
            await expect(uniswapV3.setProperties(TOKEN_B, ethers.ZeroAddress, FEE*2, 60*60)).to.be.revertedWith("IPB");
            await expect(uniswapV3.setProperties(TOKEN_B, TOKEN_A, 0, 60*60)).to.be.revertedWith("IPF");
            await expect(uniswapV3.setProperties(TOKEN_B, TOKEN_A, FEE*2, 0)).to.be.revertedWith("IPT");
        });
    });

    describe("Oracle", () => {
        it("Get an estimate amount of TokenB needed for an amount of TokenA", async () => {
            const { uniswapV3 } = await loadFixture(deployFixture);

            const tokenIn = TOKEN_A; // USDC to WETH
            const tokenOut = TOKEN_B;
            const tokenInContract: IERC20Metadata = await ethers.getContractAt("IERC20Metadata", tokenIn);
            const tokenOutContract: IERC20Metadata = await ethers.getContractAt("IERC20Metadata", tokenOut);
            const tokenInDecimals: bigint = await tokenInContract.decimals();
            const tokenOutDecimals: bigint = await tokenOutContract.decimals();

            const amount: bigint = BigInt(1600) * (BigInt(10) ** tokenInDecimals);
            const price: bigint = await uniswapV3.estimateAmountOut(tokenOut, amount)
            
            // console.log('price: ', ethers.formatUnits(price, tokenOutDecimals));
            expect(price).to.be.greaterThan(0);

            // ERRORS
            await expect(uniswapV3.estimateAmountOut(ethers.ZeroAddress, amount)).to.be.revertedWith("IPT");
            await expect(uniswapV3.estimateAmountOut(tokenOut, 0)).to.be.revertedWith("IPA");
        })
    });

    describe("Swap", () => {
        it("Should swap TokenA for the min amount of TokenB", async () => {
            const { uniswapV3, owner } = await loadFixture(deployFixture);

            const tokenIn = TOKEN_A;
            const tokenOut = TOKEN_B;
            const tokenInContract: IERC20Metadata = await ethers.getContractAt("IERC20Metadata", tokenIn);
            const tokenOutContract: IERC20Metadata = await ethers.getContractAt("IERC20Metadata", tokenOut);
            const tokenInDecimals: bigint = await tokenInContract.decimals();
            const tokenOutDecimals: bigint = await tokenOutContract.decimals();

            const balanceTokenABefore: bigint = await tokenInContract.balanceOf(owner.address);
            const balanceTokenBBefore: bigint = await tokenOutContract.balanceOf(owner.address);
            // console.log('Balance TOKEN A before: ', ethers.formatUnits(balanceTokenABefore, tokenInDecimals));
            // console.log('Balance TOKEN B before: ', ethers.formatUnits(balanceTokenBBefore, tokenOutDecimals));

            const amountOut: bigint = BigInt(1600) * (BigInt(10) ** tokenInDecimals);
            const amountInMax = await tokenOutContract.balanceOf(owner.address);

            await tokenOutContract.approve(await uniswapV3.getAddress(), amountInMax);
            await uniswapV3.swapExactOutputSingle(amountOut, amountInMax);
            const balanceTokenAAfter: bigint = await tokenInContract.balanceOf(owner.address);
            const balanceTokenBAfter: bigint = await tokenOutContract.balanceOf(owner.address);
            // console.log('Balance TOKEN A before: ', ethers.formatUnits(balanceTokenAAfter, tokenInDecimals));
            // console.log('Balance TOKEN B before: ', ethers.formatUnits(balanceTokenBAfter, tokenOutDecimals));
            
            expect(balanceTokenAAfter).to.be.equal(balanceTokenABefore + amountOut);
            expect(balanceTokenBAfter).to.be.lessThan(balanceTokenBBefore);

            // ERRORS
            await expect(uniswapV3.swapExactOutputSingle(0, amountInMax)).to.be.revertedWith("IPA");
            await expect(uniswapV3.swapExactOutputSingle(amountOut, 0)).to.be.revertedWith("IPB");
        });
    });
})