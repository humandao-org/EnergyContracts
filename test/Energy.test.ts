import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers, network } from "hardhat";
import { Energy, IERC20, IERC20Metadata, UniswapV3Twap } from "../typechain-types";

let energyContract: Energy;
let oracleContract: UniswapV3Twap;
let usdcContract: IERC20Metadata;
let usdtContract: IERC20Metadata;
let wethContract: IERC20Metadata;

const BINANCE_WALLET_ADDRESS = '0xf977814e90da44bfa03b6295a0616a897441acec'; // This might stop working at some point (if they move their funds)
const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const USDT_ADDRESS = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
const fixedExchangeRates = [
    { address: USDC_ADDRESS, amount: 4 },
    { address: USDT_ADDRESS, amount: 2 }];

const WETH_ADDRESS = '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619';
const UNISWAP_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984"
const TOKEN_A = USDC_ADDRESS
const TOKEN_B = WETH_ADDRESS
const FEE = 3000 // 0.3%

describe("Energy Token", function () {
    async function deployFixture() {
        const [owner, alice, bob] = await ethers.getSigners();

        usdcContract = await ethers.getContractAt("IERC20Metadata", USDC_ADDRESS);
        usdtContract = await ethers.getContractAt("IERC20Metadata", USDT_ADDRESS);
        wethContract = await ethers.getContractAt("IERC20Metadata", WETH_ADDRESS);

        // Deploying Oracle
        const oracleFactory = await ethers.getContractFactory("UniswapV3Twap");
        oracleContract = await oracleFactory.deploy(
            UNISWAP_FACTORY,
            TOKEN_A,
            TOKEN_B,
            FEE,
            30*60 // 30 minutes twap duration
        );
        await oracleContract.waitForDeployment();
        const oracleAddress = await oracleContract.getAddress();
        expect(oracleAddress).to.be.a.properAddress;
        const oracleTokenMintPrice: bigint = BigInt(26) * BigInt(10)**await usdcContract.decimals();

        // Deploying Energy Token
        const contractFactory = await ethers.getContractFactory("Energy");
        energyContract = await contractFactory.deploy(
            oracleAddress,
            TOKEN_B,
            oracleTokenMintPrice,
            fixedExchangeRates.map(a => a.address),
            fixedExchangeRates.map(a => a.amount)
        );
        await energyContract.waitForDeployment();

        // Get some USDC and USDT from Binance :p
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [BINANCE_WALLET_ADDRESS],
        });
        const binanceSigner = await ethers.getSigner(BINANCE_WALLET_ADDRESS);
        const stablecoinAmount = 1000000;
        const wethAmount: bigint = BigInt(100) * BigInt(10)**await wethContract.decimals(); // 100 WETH
        await usdcContract.connect(binanceSigner).transfer(owner.address, stablecoinAmount)
        await usdtContract.connect(binanceSigner).transfer(owner.address, stablecoinAmount)
        await wethContract.connect(binanceSigner).transfer(owner.address, wethAmount)
        expect(await usdcContract.balanceOf(owner.address)).to.be.equal(stablecoinAmount);
        expect(await usdtContract.balanceOf(owner.address)).to.be.equal(stablecoinAmount);
        await usdcContract.connect(binanceSigner).transfer(alice.address, stablecoinAmount)
        await usdtContract.connect(binanceSigner).transfer(alice.address, stablecoinAmount)
        expect(await usdcContract.balanceOf(alice.address)).to.be.equal(stablecoinAmount);
        expect(await usdtContract.balanceOf(alice.address)).to.be.equal(stablecoinAmount);

        return { energyContract, owner, alice, bob };
    }
 
    async function approvePaymentToken(amount: bigint, paymentToken: IERC20, account?: HardhatEthersSigner): Promise<bigint> {
        const exchangeRate = await energyContract.fixedExchangeRate(await paymentToken.getAddress());
        const price = amount * BigInt(exchangeRate)
        if(!account) {
            const [owner] = await ethers.getSigners();
            account = owner;
        }
        await paymentToken.connect(account).approve(await energyContract.getAddress(), price)
        return price
    }


    describe("Minting", () => {
        it("Should be able to mint using a constant swap (stablecoins)", async () => {
            const { energyContract, owner } = await loadFixture(deployFixture);
            await expect(energyContract.mint(owner.address, 100, USDC_ADDRESS)).to.be.revertedWithCustomError(energyContract, "Underpaid()")

            const amount = BigInt(100);
            expect(await usdcContract.balanceOf(energyContract)).to.be.equal(0);
            const price = await approvePaymentToken(amount, usdcContract);
            await expect(energyContract.mint(owner.address, amount, USDC_ADDRESS))
                .to.emit(energyContract, "Mint")
                .withArgs(owner.address, amount, USDC_ADDRESS, price);
            expect(await energyContract.balanceOf(owner.address)).to.be.equal(amount);

            await expect(energyContract.mint(owner.address, amount, USDC_ADDRESS)).to.be.revertedWithCustomError(energyContract, "Underpaid()")

            expect(await usdcContract.balanceOf(energyContract)).to.be.equal(price);
        });

        it("Should not be able to mint if paused", async () => {
            const { energyContract, owner } = await loadFixture(deployFixture);

            const amount = BigInt(100);
            await approvePaymentToken(amount, usdcContract);
            await energyContract.pause();
            await expect(energyContract.mint(owner.address, amount, USDC_ADDRESS)).to.be.revertedWith("Pausable: paused");

            await energyContract.unpause();
            await energyContract.mint(owner.address, amount, USDC_ADDRESS);
            expect(await energyContract.balanceOf(owner.address)).to.be.equal(amount);
        });

        it("Should be able to mint using the Oracle token", async () => {
            const { energyContract, owner } = await loadFixture(deployFixture);
            const amount = BigInt(100);
            const price = await energyContract.getMintPriceWithOracle(amount);

            const tokenOutContract: IERC20Metadata = await ethers.getContractAt("IERC20Metadata", TOKEN_B);
            const tokenOutDecimals: bigint = await tokenOutContract.decimals();
            // console.log('price: ', ethers.formatUnits(price, tokenOutDecimals)); // This is the formatted price in TOKEN_B (WETH)

            await tokenOutContract.approve(await energyContract.getAddress(), price);
            
            await expect(energyContract.mint(owner.address, amount, TOKEN_B))
                .to.emit(energyContract, "Mint")
                .withArgs(owner.address, amount, TOKEN_B, price);
            expect(await energyContract.balanceOf(owner.address)).to.be.equal(amount);
            expect(await tokenOutContract.balanceOf(energyContract)).to.be.equal(price);
        });
    });

    describe("Burning", () => {
        it("Should be able to burn", async () => {
            const { energyContract, owner } = await loadFixture(deployFixture);

            const amount = BigInt(100);
            const price = await approvePaymentToken(amount, usdcContract);
            await energyContract.mint(owner.address, amount, USDC_ADDRESS);
            expect(await energyContract.balanceOf(owner.address)).to.be.equal(amount);
            expect(await usdcContract.balanceOf(energyContract)).to.be.equal(price);

            const ownerUsdcBefore = await usdcContract.balanceOf(owner.address);
            await expect(energyContract.burn(amount, USDC_ADDRESS))
                .to.emit(energyContract, "Burn")
                .withArgs(owner.address, amount, USDC_ADDRESS, price);

            expect(await energyContract.balanceOf(owner.address)).to.be.equal(0);
            expect(await usdcContract.balanceOf(owner.address)).to.be.equal(ownerUsdcBefore+price);
        });

        it("Should be able to burn and get a different payment token", async () => {
            const { energyContract, owner, alice } = await loadFixture(deployFixture);

            const amountOwner = BigInt(400);
            const amountAlice = amountOwner/BigInt(4);

            const priceUSDT = await approvePaymentToken(amountOwner, usdtContract);
            await energyContract.mint(owner.address, amountOwner, USDT_ADDRESS);

            const priceUSDC = await approvePaymentToken(amountAlice, usdcContract, alice);
            await energyContract.connect(alice).mint(alice.address, amountAlice, USDC_ADDRESS);

            const ownerUsdtBefore = await usdtContract.balanceOf(owner.address);
            const ownerUsdcBefore = await usdcContract.balanceOf(owner.address);
            const aliceUsdtBefore = await usdtContract.balanceOf(alice.address);
            const aliceUsdcBefore = await usdcContract.balanceOf(alice.address);
            await expect(energyContract.connect(alice).burn(amountAlice, USDT_ADDRESS))
                .to.emit(energyContract, "Burn")
                .withArgs(alice.address, amountAlice, USDT_ADDRESS, priceUSDT/BigInt(4));

            expect(await energyContract.balanceOf(alice.address)).to.be.equal(0);
            expect(await usdtContract.balanceOf(alice.address)).to.be.equal(aliceUsdtBefore+priceUSDT/BigInt(4));
            expect(await usdcContract.balanceOf(alice.address)).to.be.equal(aliceUsdcBefore);

            // Owner still have the same balances (after his mint and alice burn)
            expect(await energyContract.balanceOf(owner.address)).to.be.equal(amountOwner);
            expect(await usdtContract.balanceOf(owner.address)).to.be.equal(ownerUsdtBefore);
            expect(await usdcContract.balanceOf(owner.address)).to.be.equal(ownerUsdcBefore);
        });

        it("Should not be able to burn if paused", async () => {
            const { energyContract, owner } = await loadFixture(deployFixture);

            const amount = BigInt(100);
            const price = await approvePaymentToken(amount, usdcContract);

            await energyContract.mint(owner.address, amount, USDC_ADDRESS);
            expect(await energyContract.balanceOf(owner.address)).to.be.equal(amount);

            await energyContract.pause();
            await expect(energyContract.burn(amount, USDC_ADDRESS)).to.be.revertedWith("Pausable: paused");

            await energyContract.unpause();
            await expect(energyContract.burn(amount, USDC_ADDRESS))
                .to.emit(energyContract, "Burn")
                .withArgs(owner.address, amount, USDC_ADDRESS, price);
            expect(await energyContract.balanceOf(owner.address)).to.be.equal(0);
        });

        it("Should not be able to burn if not funds with selected token", async () => {
            const { energyContract, owner } = await loadFixture(deployFixture);

            const amount = BigInt(100);
            await approvePaymentToken(amount, usdcContract);

            await energyContract.mint(owner.address, amount, USDC_ADDRESS);
            expect(await energyContract.balanceOf(owner.address)).to.be.equal(amount);

            await expect(energyContract.burn(amount, USDT_ADDRESS)).to.be.revertedWithCustomError(energyContract, "NotEnoughFunds()");
        });
    });
});