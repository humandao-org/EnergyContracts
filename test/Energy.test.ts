import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers, network } from "hardhat";
import { Energy } from "../typechain-types";

let energyContract: Energy;

describe("Energy Token", async () => {
    before(async () => {
        await network.provider.request({
            method: "hardhat_reset", 
            params: [{
                forking: { jsonRpcUrl:'https://eth-sepolia.g.alchemy.com/v2/' + process.env.ALCHEMY_TOKEN }
            }]
        });
    });

    async function deployFixture() {
        const [owner, alice, bob] = await ethers.getSigners();

        // Deploying Energy Token
        const contractFactory = await ethers.getContractFactory("Energy");
        energyContract = await contractFactory.deploy(owner.address, owner.address);
        await energyContract.waitForDeployment();
        const energyAddress = await energyContract.getAddress();
        expect(energyAddress).to.be.a.properAddress;

        return { energyContract, owner, alice, bob };
    }

    describe("Deployment & Admin", () => {
        it("Should be a proper address and have default settings", async () => {
            const { owner } = await loadFixture(deployFixture);
            expect(await energyContract.getAddress()).to.be.a.properAddress;
            expect(await energyContract.owner()).to.be.equal(owner.address);
            expect(await energyContract.factory()).to.be.equal(owner.address);
            expect(await energyContract.decimals()).to.be.equal(2);
        });

        it("Should be able to change its Owner", async () => {
            const { owner, alice } = await loadFixture(deployFixture);
            await energyContract.transferOwnership(alice.address);
            expect(await energyContract.owner()).to.be.equal(alice.address);

            // ERRORS
            await expect(energyContract.transferOwnership(owner.address)).to.be.revertedWithCustomError(energyContract, "OwnableUnauthorizedAccount");
            await expect(energyContract.connect(alice).transferOwnership(ethers.ZeroAddress)).to.be.revertedWithCustomError(energyContract, "OwnableInvalidOwner");
        })

        it("Should be able to Pause", async () => {
            const { alice } = await loadFixture(deployFixture);
            await energyContract.pause();
            expect(await energyContract.paused()).to.be.equal(true);

            // Errors
            await expect(energyContract.connect(alice).pause()).to.be.revertedWithCustomError(energyContract, "OwnableUnauthorizedAccount");
            await expect(energyContract.connect(alice).unpause()).to.be.revertedWithCustomError(energyContract, "OwnableUnauthorizedAccount");
        });

        it("Should be able to change the Factory", async () => {
            const { alice } = await loadFixture(deployFixture);
            await energyContract.setFactory(alice.address);

            expect(await energyContract.factory()).to.be.equal(alice.address);

            // Errors
            await expect(energyContract.connect(alice).setFactory(alice.address)).to.be.revertedWithCustomError(energyContract, "OwnableUnauthorizedAccount");
        });

        it("Should NOT be able to call Factory functions", async () => {
            const { alice } = await loadFixture(deployFixture);
            await expect(energyContract.connect(alice).mint(alice.address, 1000)).to.be.revertedWithCustomError(energyContract, "UnauthorizedFactory");
            await expect(energyContract.connect(alice)["burn(address,uint256)"](alice.address, 1000)).to.be.revertedWithCustomError(energyContract, "UnauthorizedFactory");
        });
    });

    describe("Minting", () => {
        it("Should be able to mint from the Factory address", async () => {
            const { alice } = await loadFixture(deployFixture);

            const amount = 1000;
            await expect(energyContract.mint(alice.address, amount)).to.emit(energyContract, "Mint").withArgs(alice.address, amount);
            expect(await energyContract.balanceOf(alice.address)).to.be.equal(amount);
        });

        it("Should NOT be able to mint from outside the Factory address", async () => {
            const { alice } = await loadFixture(deployFixture);

            const amount = 1000;
            await expect(energyContract.connect(alice).mint(alice.address, amount)).to.be.revertedWithCustomError(energyContract, "UnauthorizedFactory");
        });

        it("Should not be able to mint if paused", async () => {
            const { alice } = await loadFixture(deployFixture);
            
            const amount = 1000;
            await energyContract.pause();
            await expect(energyContract.mint(alice.address, amount)).to.be.revertedWithCustomError(energyContract, "EnforcedPause");

            await energyContract.unpause();
            await energyContract.mint(alice.address, amount);
            expect(await energyContract.balanceOf(alice.address)).to.be.equal(amount);
        });
    });

    describe("Burning", () => {
        it("Should be able to burn from the Factory address", async () => {
            const { owner, alice } = await loadFixture(deployFixture);

            const amount = 1000;
            await energyContract.mint(owner.address, amount);
            expect(await energyContract.balanceOf(owner.address)).to.be.equal(amount);
            await energyContract["burn(address,uint256)"](owner.address, amount);
            expect(await energyContract.balanceOf(owner.address)).to.be.equal(0);

            // Errors
            await expect(energyContract.connect(alice)["burn(address,uint256)"](alice.address, amount)).to.be.revertedWithCustomError(energyContract, "UnauthorizedFactory");
        });

        it("Should NOT be able to burn from outside the Factory address", async () => {
            const { owner, alice } = await loadFixture(deployFixture);

            const amount = 1000;
            await energyContract.mint(owner.address, amount);
            expect(await energyContract.balanceOf(owner.address)).to.be.equal(amount);
            await expect(energyContract.connect(alice)["burn(address,uint256)"](alice.address, amount)).to.be.revertedWithCustomError(energyContract, "UnauthorizedFactory");
        });

        it("Should not be able to burn if paused", async () => {
            const { owner } = await loadFixture(deployFixture);

            const amount = 1000;
            await energyContract.mint(owner.address, amount);
            expect(await energyContract.balanceOf(owner.address)).to.be.equal(amount);

            await energyContract.pause();
            await expect(energyContract["burn(address,uint256)"](owner.address, amount)).to.be.revertedWithCustomError(energyContract, "EnforcedPause");
            expect(await energyContract.balanceOf(owner.address)).to.be.equal(amount);
        });

        it("Should fail calling default burn function", async () => {
            const { owner } = await loadFixture(deployFixture);

            const amount = 1000;
            await energyContract.mint(owner.address, amount);
            expect(await energyContract.balanceOf(owner.address)).to.be.equal(amount);
            await expect(energyContract["burn(uint256)"](amount)).to.be.revertedWithCustomError(energyContract, "DisabledDefaultBurn");
        });
    });
});
