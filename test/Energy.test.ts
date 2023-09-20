import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { Energy, IERC20 } from "../typechain-types";
import { ethers, network } from "hardhat";
import { Contract } from "ethers";

let energyContract: Energy;
let usdcContract: IERC20;
let usdtContract: IERC20;
const BINANCE_WALLET_ADDRESS = '0xf977814e90da44bfa03b6295a0616a897441acec'; // This might stop working at some point (if they move their funds)
const USDC_ADDRESS = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174';
const USDT_ADDRESS = '0xc2132d05d31c914a87c6611c10748aeb04b58e8f';
const fixedExchangeRates = [
    { address: USDC_ADDRESS, amount: 4 },
    { address: USDT_ADDRESS, amount: 2 }];

describe("Energy Token", function () {
    async function deployFixture() {
        const [owner, alice, bob] = await ethers.getSigners();

        // Deploying Energy Token
        const contractFactory = await ethers.getContractFactory("Energy");
        energyContract = await contractFactory.deploy(
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
        usdcContract = await ethers.getContractAt("IERC20", USDC_ADDRESS);
        usdtContract = await ethers.getContractAt("IERC20", USDT_ADDRESS);
        const stablecoinAmount = 1000000;
        await usdcContract.connect(binanceSigner).transfer(owner.address, stablecoinAmount)
        await usdtContract.connect(binanceSigner).transfer(owner.address, stablecoinAmount)
        expect(await usdcContract.balanceOf(owner.address)).to.be.equal(stablecoinAmount);
        expect(await usdtContract.balanceOf(owner.address)).to.be.equal(stablecoinAmount);
        await usdcContract.connect(binanceSigner).transfer(alice.address, stablecoinAmount)
        await usdtContract.connect(binanceSigner).transfer(alice.address, stablecoinAmount)
        expect(await usdcContract.balanceOf(alice.address)).to.be.equal(stablecoinAmount);
        expect(await usdtContract.balanceOf(alice.address)).to.be.equal(stablecoinAmount);

        return { energyContract, owner, alice, bob };
    }
 
    async function approveStablecoin(amount: bigint, paymentToken: IERC20): Promise<bigint> {
        const exchangeRate = await energyContract.fixedExchangeRate(await paymentToken.getAddress());
        const price = amount * BigInt(exchangeRate)
        await usdcContract.approve(await energyContract.getAddress(), price)
        return price
    }

    describe("Deployment & Admin", () => {
        it("Should be a proper address, and owner", async () => {
            const { energyContract, owner } = await loadFixture(deployFixture);
            expect(await energyContract.getAddress()).to.be.a.properAddress;
            expect(await energyContract.owner()).to.be.equal(owner.address);
        });
     
        it("Should be able to set the exchange rates", async () => {
            const { energyContract, alice } = await loadFixture(deployFixture);
            expect(await energyContract.fixedExchangeRate(USDC_ADDRESS)).to.be.equal(4);
            expect(await energyContract.fixedExchangeRate(USDT_ADDRESS)).to.be.equal(2);
            await energyContract.setFixedExchangeRates(fixedExchangeRates.map(a => a.address), [4,4]);
            expect(await energyContract.fixedExchangeRate(USDC_ADDRESS)).to.be.equal(4);
            expect(await energyContract.fixedExchangeRate(USDT_ADDRESS)).to.be.equal(4);

            await(expect(energyContract.connect(alice).setFixedExchangeRates(fixedExchangeRates.map(a => a.address), fixedExchangeRates.map(a => a.amount)))).to.be.revertedWith("Ownable: caller is not the owner");
            await(expect(energyContract.setFixedExchangeRates([ethers.ZeroAddress], [1]))).to.be.revertedWithCustomError(energyContract, "InvalidParams");
            await(expect(energyContract.setFixedExchangeRates(fixedExchangeRates.map(a => a.address), [1]))).to.be.revertedWithCustomError(energyContract, "InvalidParams");
            await(expect(energyContract.setFixedExchangeRates(fixedExchangeRates.map(a => a.address), [0,0]))).to.be.revertedWithCustomError(energyContract, "InvalidParams");

        });

        it("Owner should be able to transfer the ownership", async () => {
            const { energyContract, alice, bob } = await loadFixture(deployFixture);

            await expect(energyContract.connect(alice).transferOwnership(bob.address)).to.be.revertedWith("Ownable: caller is not the owner");

            await energyContract.transferOwnership(bob.address);
            expect(await energyContract.owner()).to.be.equal(bob.address);
        });

        it("Owner should be able to pause the contract", async () => {
            const { energyContract, alice } = await loadFixture(deployFixture);
            expect(await energyContract.paused()).to.be.equal(false);
            await energyContract.pause();
            expect(await energyContract.paused()).to.be.equal(true);
            await energyContract.unpause();
            expect(await energyContract.paused()).to.be.equal(false);

            await expect(energyContract.connect(alice).pause()).to.be.revertedWith("Ownable: caller is not the owner");
        });
    });

    describe("Minting", () => {
        it("Should be able to mint using a constant swap (stablecoins)", async () => {
            const { energyContract, owner } = await loadFixture(deployFixture);
            await expect(energyContract.mint(owner.address, 100, USDC_ADDRESS)).to.be.revertedWithCustomError(energyContract, "Underpaid()")

            const amount = BigInt(100);
            expect(await usdcContract.balanceOf(energyContract)).to.be.equal(0);
            const price = await approveStablecoin(amount, usdcContract);
            await energyContract.mint(owner.address, amount, USDC_ADDRESS);
            expect(await energyContract.balanceOf(owner.address)).to.be.equal(amount);

            await expect(energyContract.mint(owner.address, amount, USDC_ADDRESS)).to.be.revertedWithCustomError(energyContract, "Underpaid()")

            expect(await usdcContract.balanceOf(energyContract)).to.be.equal(price);
        });

        it("Should not be able to mint if paused", async () => {
            const { energyContract, owner } = await loadFixture(deployFixture);

            const amount = BigInt(100);
            await approveStablecoin(amount, usdcContract);
            await energyContract.pause();
            await expect(energyContract.mint(owner.address, amount, USDC_ADDRESS)).to.be.revertedWith("Pausable: paused");

            await energyContract.unpause();
            await energyContract.mint(owner.address, amount, USDC_ADDRESS);
            expect(await energyContract.balanceOf(owner.address)).to.be.equal(amount);
        });
    });

    describe("Burning", () => {
        it("Should be able to burn", async () => {
            const { energyContract, owner } = await loadFixture(deployFixture);

            const amount = BigInt(100);
            await approveStablecoin(amount, usdcContract);
            await energyContract.mint(owner.address, amount, USDC_ADDRESS);
            expect(await energyContract.balanceOf(owner.address)).to.be.equal(amount);
            await energyContract.burn(amount);
            expect(await energyContract.balanceOf(owner.address)).to.be.equal(0);
        });

        it("Should not be able to burn if paused", async () => {
            const { energyContract, owner } = await loadFixture(deployFixture);

            const amount = BigInt(100);
            await approveStablecoin(amount, usdcContract);

            await energyContract.mint(owner.address, amount, USDC_ADDRESS);
            expect(await energyContract.balanceOf(owner.address)).to.be.equal(amount);

            await energyContract.pause();
            await expect(energyContract.burn(amount)).to.be.revertedWith("Pausable: paused");

            await energyContract.unpause();
            await energyContract.burn(amount);
            expect(await energyContract.balanceOf(owner.address)).to.be.equal(0);
        });
    });
});