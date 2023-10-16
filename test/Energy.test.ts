import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers, network } from "hardhat";
import { Energy, EnergyLogic, IERC20, IERC20Metadata } from "../typechain-types";

let energyContract: Energy;
let energyLogicContract: EnergyLogic;
let usdcContract: IERC20Metadata;
let usdtContract: IERC20Metadata;
let wethContract: IERC20Metadata;

const BINANCE_WALLET_ADDRESS = '0xf977814e90da44bfa03b6295a0616a897441acec'; // This might stop working at some point (if they move their funds)
const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const USDT_ADDRESS = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
const WETH_ADDRESS = '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619';
const fixedExchangeRates = [
    { address: USDC_ADDRESS, amount: 4 },
    { address: USDT_ADDRESS, amount: 2 }];

describe("Energy Token", async () => {
    before(async () => {
        await network.provider.request({
            method: "hardhat_reset", 
            params: [{
                forking: { jsonRpcUrl: 'https://polygon-mainnet.g.alchemy.com/v2/' + process.env.ALCHEMY_TOKEN }
            }]
        });
    });
     
    async function approvePaymentToken(amount: bigint, paymentToken: IERC20, account?: HardhatEthersSigner): Promise<bigint> {
        const exchangeRate = await energyLogicContract.fixedExchangeRate(await paymentToken.getAddress());
        const price = amount * BigInt(exchangeRate)
        if(!account) {
            const [owner] = await ethers.getSigners();
            account = owner;
        }

        await paymentToken.connect(account).approve(await energyContract.getAddress(), price);
        return price
    }

    async function deployFixture() {
        const [owner, alice, bob] = await ethers.getSigners();
        usdcContract = await ethers.getContractAt("IERC20Metadata", USDC_ADDRESS);
        usdtContract = await ethers.getContractAt("IERC20Metadata", USDT_ADDRESS);
        wethContract = await ethers.getContractAt("IERC20Metadata", WETH_ADDRESS);

        // Deploying Energy Token Logic
        const energyLogicFactory = await ethers.getContractFactory("EnergyLogic");
        energyLogicContract = await energyLogicFactory.deploy(
            fixedExchangeRates.map(a => a.address),
            fixedExchangeRates.map(a => a.amount),
            [WETH_ADDRESS]
        );
        await energyLogicContract.waitForDeployment();
        const energyLogicAddress = await energyLogicContract.getAddress();
        expect(energyLogicAddress).to.be.a.properAddress;

        // Deploying Energy Token
        const contractFactory = await ethers.getContractFactory("Energy");
        energyContract = await contractFactory.deploy(energyLogicAddress);
        await energyContract.waitForDeployment();
        const energyAddress = await energyContract.getAddress();
        expect(energyAddress).to.be.a.properAddress;

        // Set the energy token address into logic contract
        energyLogicContract.setEnergyToken(energyAddress);

        // Get some USDC and USDT from Binance :p
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [BINANCE_WALLET_ADDRESS],
        });
        const binanceSigner = await ethers.getSigner(BINANCE_WALLET_ADDRESS);
        const usdcAmount: bigint = BigInt(100000) * BigInt(10)**await usdcContract.decimals(); // 100000 USDC
        const usdtAmount: bigint = BigInt(100000) * BigInt(10)**await usdcContract.decimals(); // 100000 USDT
        const wethAmount: bigint = BigInt(100) * BigInt(10)**await wethContract.decimals(); // 100 WETH
        await usdcContract.connect(binanceSigner).transfer(owner.address, usdcAmount)
        await usdtContract.connect(binanceSigner).transfer(owner.address, usdtAmount)
        await wethContract.connect(binanceSigner).transfer(owner.address, wethAmount)
        expect(await usdcContract.balanceOf(owner.address)).to.be.equal(usdcAmount);
        expect(await usdtContract.balanceOf(owner.address)).to.be.equal(usdtAmount);
        await usdcContract.connect(binanceSigner).transfer(alice.address, usdcAmount)
        await usdtContract.connect(binanceSigner).transfer(alice.address, usdtAmount)
        expect(await usdcContract.balanceOf(alice.address)).to.be.equal(usdcAmount);
        expect(await usdtContract.balanceOf(alice.address)).to.be.equal(usdtAmount);

        return { energyContract, owner, alice, bob };
    }

    describe("Deployment & Admin", () => {
        it("Should be a proper address", async () => {
            const { energyContract, owner } = await loadFixture(deployFixture);
            expect(await energyContract.getAddress()).to.be.a.properAddress;
            expect(await energyContract.owner()).to.be.equal(owner.address);
        });

        it("Should be able to change its Owner", async () => {
            const { energyContract, owner, alice } = await loadFixture(deployFixture);
            await energyContract.transferOwnership(alice.address);
            expect(await energyContract.owner()).to.be.equal(alice.address);

            // ERRORS
            await expect(energyContract.transferOwnership(owner.address)).to.be.revertedWith("Ownable: caller is not the owner");
            await expect(energyContract.connect(alice).transferOwnership(ethers.ZeroAddress)).to.be.revertedWith("Ownable: new owner is the zero address");
        })

        it("Should be able to Pause", async () => {
            const { energyContract, alice } = await loadFixture(deployFixture);
            await energyContract.pause();
            expect(await energyContract.paused()).to.be.equal(true);

            // Errors
            await expect(energyContract.connect(alice).pause()).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("Should be able to change the EnergyLogic", async () => {
            const { energyContract, alice } = await loadFixture(deployFixture);
            await energyContract.setEnergyLogic(alice.address);

            expect(await energyContract.energyLogic()).to.be.equal(alice.address);

            // Errors
            await expect(energyContract.connect(alice).setEnergyLogic(alice.address)).to.be.revertedWith("Ownable: caller is not the owner");
        });
    });

    describe("Minting", () => {
        it("Should be able to mint using a constant swap (stablecoins)", async () => {
            const { energyContract, owner } = await loadFixture(deployFixture);
            
            const amount = BigInt(100);
            expect(await usdcContract.balanceOf(energyContract)).to.be.equal(0);
            const price = await approvePaymentToken(amount, usdcContract);
            await expect(energyContract.mint(owner.address, amount, USDC_ADDRESS))
                .to.emit(energyContract, "Mint")
                .withArgs(owner.address, amount, USDC_ADDRESS, price);
            expect(await energyContract.balanceOf(owner.address)).to.be.equal(amount);

            expect(await usdcContract.balanceOf(energyContract)).to.be.equal(price);

            // Errors
            await expect(energyContract.mint(owner.address, 0, USDC_ADDRESS)).to.be.revertedWithCustomError(energyContract, "InvalidParamsZeroValue()");
            await expect(energyContract.mint(owner.address, amount, ethers.ZeroAddress)).to.be.revertedWithCustomError(energyContract, "InvalidParamsZeroAddress()");
            await expect(energyContract.mint(owner.address, amount, BINANCE_WALLET_ADDRESS)).to.be.revertedWithCustomError(energyLogicContract, "InvalidParamsZeroValue()");
            await expect(energyContract.mint(owner.address, amount, USDC_ADDRESS)).to.be.revertedWithCustomError(energyLogicContract, "Underpaid()");
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

        it("Should be able to mint using dynamic token pricing",async () => {
// 1) User enters the amount of desired $ENRG and selects which token to pay with e.g. Matic, Aave or Mana
// 2) System finds the dollar amount of the selected token corresponding to $2.60 (the price per energy when paid in $HDAO) and shows the corresponding amount in the selected token to the user.
// 3) User approves the transaction and pays for gas
// 4) System receives the tokens and converts it to $USDC (an amount corresponding to $2) and to $HDAO (the remaining part that corresponds to $0.6)
// 5) System stores the USDC and HDAO on the contract.
            const { energyContract, owner } = await loadFixture(deployFixture);
            const amount = BigInt(100);
            // const price = await approvePaymentToken(amount, wethContract);
        })
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

            // Errors
            await expect(energyContract.burn(0, USDT_ADDRESS)).to.be.revertedWithCustomError(energyContract, "InvalidParamsZeroValue()");
            await expect(energyContract.burn(amountOwner, ethers.ZeroAddress)).to.be.revertedWithCustomError(energyContract, "InvalidParamsZeroAddress()");
            await expect(energyContract.burn(amountOwner*BigInt(2), USDT_ADDRESS)).to.be.revertedWithCustomError(energyLogicContract, "NotEnoughFunds()");
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
    });

    describe("Withdrawals", () => {
        describe("Validations", () => {    
            it("Should revert with the right error if called from another account", async () => {
                const { energyContract, alice } = await loadFixture(deployFixture);
                await expect(energyContract.connect(alice).withdraw(USDC_ADDRESS)).to.be.revertedWith("Ownable: caller is not the owner");
            });
        });
    
        describe("Events", function () {
            it("Should emit an event on withdrawals", async () => {
                const { energyContract } = await loadFixture(deployFixture);

                await expect(energyContract.withdraw(USDC_ADDRESS)).to.emit(energyContract, "Withdrawal");
            });
        });
    
        describe("Transfers", function () {
            it("Should transfer the funds (ERC20) to the owner", async function () {
                const { energyContract, owner } = await loadFixture(deployFixture);

                const amount = BigInt(100);
                const price = await approvePaymentToken(amount, usdcContract);
                await energyContract.mint(owner.address, amount, USDC_ADDRESS);

                const balanceBefore = await usdcContract.balanceOf(owner.address);

                await expect(energyContract.withdraw(USDC_ADDRESS)).to.emit(energyContract, "Withdrawal");
                expect(await usdcContract.balanceOf(await energyContract.getAddress())).to.be.equal(0);
                expect(await usdcContract.balanceOf(owner.address)).to.be.equal(price+balanceBefore);
            });
        });
    });

});