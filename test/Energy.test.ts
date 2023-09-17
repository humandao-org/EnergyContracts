import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers, network } from "hardhat";
import { Contract } from "ethers";
import { Energy } from "../typechain-types";

let energyContract: Energy;

describe("Energy", function () {
    async function deployFixture() {
        const [owner, alice, bob] = await ethers.getSigners();

        // Deploying Energy Token
        const contractFactory = await ethers.getContractFactory("Energy");
        energyContract = await contractFactory.deploy();
        await energyContract.waitForDeployment();

        return { energyContract, owner, alice, bob };
    }

    describe("Deployment & Admin", () => {
        it("Should be a proper address, and owner", async () => {
            const { energyContract, owner } = await loadFixture(deployFixture);
            expect(await energyContract.getAddress()).to.be.a.properAddress;
            expect(await energyContract.owner()).to.be.equal(owner.address);
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
        it("Should be able to mint", async () => {
            const { energyContract, owner, alice } = await loadFixture(deployFixture);
            await energyContract.mint(owner.address, 100);
            expect(await energyContract.balanceOf(owner.address)).to.be.equal(100);
            await energyContract.mint(alice.address, 100);
            expect(await energyContract.balanceOf(alice.address)).to.be.equal(100);
        });

        it("Should not be able to mint if paused", async () => {
            const { energyContract, owner } = await loadFixture(deployFixture);
            await energyContract.pause();
            await expect(energyContract.mint(owner.address, 100)).to.be.revertedWith("Pausable: paused");
        });
    });

    describe("Burning", () => {
        it("Should be able to burn", async () => {
            const { energyContract, owner } = await loadFixture(deployFixture);
            await energyContract.mint(owner.address, 100);
            expect(await energyContract.balanceOf(owner.address)).to.be.equal(100);
            await energyContract.burn(100);
            expect(await energyContract.balanceOf(owner.address)).to.be.equal(0);
        });

        it("Should not be able to burn if paused", async () => {
            const { energyContract, owner } = await loadFixture(deployFixture);
            await energyContract.mint(owner.address, 100);
            await energyContract.pause();
            await expect(energyContract.burn(100)).to.be.revertedWith("Pausable: paused");
        });
    });
});