import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { TransactionRequest } from "ethers";
import { ethers, network } from "hardhat";
import { Energy, EnergyLogic } from "../typechain-types";

let energyLogicContract: EnergyLogic;
let energyContract: Energy;

const HDAO_ADDRESS = '0x72928d5436Ff65e57F72D5566dCd3BaEDC649A88';
const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const USDT_ADDRESS = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
const WETH_ADDRESS = '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619';
const AAVE_ADDRESS = '0xD6DF932A45C0f255f85145f286eA0b292B21C90B';

const fixedExchangeRates = [
    { address: USDC_ADDRESS, amount: 4 },
    { address: USDT_ADDRESS, amount: 2 }];

describe("EnergyLogic", async () => {
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

        // Deploying EnergyLogic
        const energyLogicFactory = await ethers.getContractFactory("EnergyLogic");
        energyLogicContract = await energyLogicFactory.deploy(
            BigInt("3000"),
            fixedExchangeRates.map(a => a.address),
            fixedExchangeRates.map(a => a.amount),
            [WETH_ADDRESS, AAVE_ADDRESS]
        );
        await energyLogicContract.waitForDeployment();
        const energyLogicAddress = await energyLogicContract.getAddress();
        expect(energyLogicAddress).to.be.a.properAddress;

        return { energyLogicContract, owner, alice, bob };
    }

    /*
    describe("Deployment & Admin", () => {
        it("Should be a proper address", async () => {
            const { energyLogicContract, owner } = await loadFixture(deployFixture);
            expect(await energyLogicContract.getAddress()).to.be.a.properAddress;
            expect(await energyLogicContract.owner()).to.be.equal(owner.address);
        });

        it("Should be able to change its Owner", async () => {
            const { energyLogicContract, owner, alice } = await loadFixture(deployFixture);
            await energyLogicContract.transferOwnership(alice.address);
            expect(await energyLogicContract.owner()).to.be.equal(alice.address);

            // ERRORS
            await expect(energyLogicContract.transferOwnership(owner.address)).to.be.revertedWith("Ownable: caller is not the owner");
            await expect(energyLogicContract.connect(alice).transferOwnership(ethers.ZeroAddress)).to.be.revertedWith("Ownable: new owner is the zero address");
        })

        it("Should be able to set the EnergyToken Contract", async () => {
            const { energyLogicContract, alice } = await loadFixture(deployFixture);

            const contractFactory = await ethers.getContractFactory("Energy");
            energyContract = await contractFactory.deploy(await energyLogicContract.getAddress());
            await energyContract.waitForDeployment();
            const energyAddress = await energyContract.getAddress();
            expect(energyAddress).to.be.a.properAddress;

            await energyLogicContract.setEnergyToken(energyAddress);
            expect(await energyLogicContract.energyToken()).be.equal(energyAddress);

            // ERRORS
            await expect(energyLogicContract.connect(alice).setEnergyToken(ethers.ZeroAddress)).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("Should be able to set the Fixed Exchange Rates", async () => {
            const { energyLogicContract, alice } = await loadFixture(deployFixture);

            const testFixedExchangeRates = [
                { address: USDC_ADDRESS, amount: 23 },
                { address: USDT_ADDRESS, amount: 42 }];
            
            await energyLogicContract.setFixedExchangeRates(
                testFixedExchangeRates.map(a => a.address), 
                testFixedExchangeRates.map(a => a.amount)
            );

            expect(await energyLogicContract.fixedExchangeRate(USDC_ADDRESS)).to.be.equal(23);
            expect(await energyLogicContract.fixedExchangeRate(USDT_ADDRESS)).to.be.equal(42);

            // ERRORS
            await expect(energyLogicContract.connect(alice).setFixedExchangeRates([ethers.ZeroAddress], [0])).to.be.revertedWith("Ownable: caller is not the owner");
            await expect(energyLogicContract.setFixedExchangeRates([ethers.ZeroAddress], [0, 1])).to.be.revertedWithCustomError(energyLogicContract, "InvalidParamsLength()")
            await expect(energyLogicContract.setFixedExchangeRates([ethers.ZeroAddress], [1])).to.be.revertedWithCustomError(energyLogicContract, "InvalidParamsZeroAddress()")
            await expect(energyLogicContract.setFixedExchangeRates([USDC_ADDRESS], [0])).to.be.revertedWithCustomError(energyLogicContract, "InvalidParamsZeroValue()")
            
        });

        it("Should be able to set the Dynamic Exchange Rates", async () => {
            const { energyLogicContract, alice, bob } = await loadFixture(deployFixture);

            const testDynamicExchangeRates = [alice.address, bob.address];
            await energyLogicContract.setDynamicExchangeTokens(testDynamicExchangeRates);
            expect(await energyLogicContract.dynamicExchangeTokens(alice.address)).to.be.true;
            expect(await energyLogicContract.dynamicExchangeTokens(bob.address)).to.be.true;

            // ERRORS
            await expect(energyLogicContract.connect(alice).setDynamicExchangeTokens([ethers.ZeroAddress])).to.be.revertedWith("Ownable: caller is not the owner");
            await expect(energyLogicContract.setDynamicExchangeTokens([])).to.be.revertedWithCustomError(energyLogicContract, "InvalidParamsLength()")
            await expect(energyLogicContract.setDynamicExchangeTokens([ethers.ZeroAddress])).to.be.revertedWithCustomError(energyLogicContract, "InvalidParamsZeroAddress()")
        });

        it("Should be able to set the Max Mint Amount", async () => {
            const { energyLogicContract, alice } = await loadFixture(deployFixture);

            expect(await energyLogicContract.maxMintAmount()).to.be.equal(3000);
            await energyLogicContract.setMaxMintAmount(1000);
            expect(await energyLogicContract.maxMintAmount()).to.be.equal(1000);
            
            // ERRORS
            await expect(energyLogicContract.connect(alice).setMaxMintAmount(BigInt("0"))).to.be.revertedWith("Ownable: caller is not the owner");
            await expect(energyLogicContract.setMaxMintAmount(BigInt("0"))).to.be.revertedWithCustomError(energyLogicContract, "InvalidParamsZeroValue()")
        });

        it("Shouldn't be able to execute onlyEnergy functions", async () => {
            const { energyLogicContract, owner } = await loadFixture(deployFixture);

            await expect(energyLogicContract.beforeMint(owner.address, 0, owner.address)).to.be.revertedWithCustomError(energyLogicContract, "OnlyEnergy()")
            await expect(energyLogicContract.afterMint(owner.address, 0, owner.address)).to.be.revertedWithCustomError(energyLogicContract, "OnlyEnergy()")
            await expect(energyLogicContract.beforeBurn(owner.address, 0, owner.address)).to.be.revertedWithCustomError(energyLogicContract, "OnlyEnergy()")
            await expect(energyLogicContract.afterBurn(owner.address, 0, owner.address, 0)).to.be.revertedWithCustomError(energyLogicContract, "OnlyEnergy()")
        });
    });
    */

    describe("Exchange Rates", () => {
        it("Should be able to get the Dynamic Exchange Rate", async () => {
            const { energyLogicContract, alice } = await loadFixture(deployFixture);
            const enrgAmount = 100;

            const data = energyLogicContract.interface.encodeFunctionData("getPrice", [enrgAmount, HDAO_ADDRESS]);
            const tx: TransactionRequest = {
                to: await energyLogicContract.getAddress(),
                data: data
            }
            const res = await alice.call(tx);
            const decoded = energyLogicContract.interface.decodeFunctionResult("getPrice", res);

            console.log(decoded.toString());
        });
    });
});