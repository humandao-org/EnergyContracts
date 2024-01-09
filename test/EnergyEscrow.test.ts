import { ethers, network } from "hardhat";
import { expect } from "chai";
import { Energy, EnergyEscrow, IERC20 } from "../typechain-types";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { v4 as uuidv4 } from "uuid";
import { defaultAbiCoder } from "@ethersproject/abi";
import { keccak256 } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

const CONTRACT_OWNER_ADDRESS = "0x9d571d386Dd15dBb2dcF848FB10d54eCBE91A26E";
const OWNER_1_ADDRESS = "0x77693a5D3881dD7F99964219e2827883e66D7E9e";
const OWNER_2_ADDRESS = "";
const ASSISTANT_1_ADDRESS = "0x7491C6bCf3467973c01253F9176f56a53B680F89";
const ASSISTANT_2_ADDRESS = "";

describe("EnergyEscrow", async () => {
  let energyEscrow: EnergyEscrow;
  let energyToken: Energy; // Replace this with the actual token type if different
  // Add other necessary variables here

  // Deploy the contract before running tests
  before(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl:
              "https://eth-sepolia.g.alchemy.com/v2/" +
              process.env.ALCHEMY_TOKEN,
          },
        },
      ],
    });
  });

  async function deployFixture() {
    const [
      owner,
      taskOwner,
      assistant,
      assistant2,
      assistant3,
      assistant4,
      assistant5,
    ] = await ethers.getSigners();
    const mintAmount = 100000; // 1000 ENRG tokens
    // Deploying Energy Token
    const contractFactory = await ethers.getContractFactory("Energy");
    energyToken = await contractFactory.deploy(owner.address, owner.address);
    await energyToken.waitForDeployment();
    const energyAddress = await energyToken.getAddress();
    expect(energyAddress).to.be.a.properAddress;

    //Owner minting for purposes
    await energyToken.mint(taskOwner.address, mintAmount);

    // Deploying Factory
    const escrow = await ethers.getContractFactory("EnergyEscrow");
    energyEscrow = await escrow.connect(owner).deploy(energyAddress);

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [CONTRACT_OWNER_ADDRESS],
    });
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [OWNER_1_ADDRESS],
    });
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [ASSISTANT_1_ADDRESS],
    });
    // await network.provider.request({ method: "hardhat_impersonateAccount", params: [BINANCE_WALLET_ADDRESS]});
    await owner.sendTransaction({
      to: OWNER_1_ADDRESS,
      value: ethers.parseEther("1.0"),
    });
    await owner.sendTransaction({
      to: ASSISTANT_1_ADDRESS,
      value: ethers.parseEther("1.0"),
    });

    return {
      owner,
      taskOwner,
      assistant,
      assistant2,
      assistant3,
      assistant4,
      assistant5,
    };
  }

  function generateUUID(address: string) {
    const uuid = uuidv4();
    const formattedUuid = uuid.replace(/-/g, "").padEnd(64, "0");

    return keccak256(
      defaultAbiCoder.encode(["address", "string"], [address, formattedUuid])
    );
  }
  describe("Deployment", async () => {
    it("Should set the right owner", async () => {
      const { owner } = await loadFixture(deployFixture);
      expect(await energyEscrow.owner()).to.equal(owner.address);
    });

    it("Should be able to transfer ownership", async () => {
      const { owner } = await loadFixture(deployFixture);
      const dummyAddress = "0x491afdEd42f1cBAc4E141f3a64aD0C10FA6C209B";
      await energyEscrow.connect(owner).transferOwnership(dummyAddress);
      expect(await energyEscrow.owner()).to.equal(dummyAddress);
    });

    // Add more deployment-related tests here
  });

  describe.only("Deposits", async () => {
    let owner: HardhatEthersSigner,
      taskOwner: HardhatEthersSigner,
      assistant: HardhatEthersSigner,
      depositUuid: string,
      depositAmount: any;

    // Common setup for the deposit tests
    beforeEach(async () => {
      ({ owner, taskOwner, assistant } = await loadFixture(deployFixture));
      depositAmount = BigInt(100000); // 1000 ENRG tokens
      depositUuid = generateUUID(await taskOwner.getAddress());

      await energyToken
        .connect(taskOwner)
        .approve(await energyEscrow.getAddress(), depositAmount);
      await energyEscrow.connect(taskOwner).deposit(depositUuid, depositAmount);
    });

    it("Should allow task owners to deposit ENRG tokens", async () => {
      const deposit = await energyEscrow.viewDeposit(depositUuid);
      expect(deposit.depositor).to.equal(taskOwner.address);
      expect(deposit.amount).to.equal(depositAmount);
    });

    it("Should allow the contract owner to refund a deposit", async () => {
      await energyEscrow.refund(depositUuid);

      const deposit = await energyEscrow.viewDeposit(depositUuid);
      console.log("🚀 ~ file: EnergyEscrow.test.ts:148 ~ it ~ deposit:", deposit)
    });

    it("Should allow the contract owner refund and delete a deposit", async () => {
      const deposit = await energyEscrow.viewDeposit(depositUuid);
      expect(deposit.depositor).to.equal(taskOwner.address);
      expect(deposit.amount).to.equal(depositAmount);
    });
  });

  describe("Standard Tasks", async () => {
    let owner: HardhatEthersSigner,
      taskOwner: HardhatEthersSigner,
      assistant: HardhatEthersSigner,
      depositUuid: string,
      depositAmount: any;
    let recipientUuid: string;
    const assistantNumber = 1;
    // Common setup for the deposit tests
    beforeEach(async () => {
      ({ owner, taskOwner, assistant } = await loadFixture(deployFixture));
      depositAmount = BigInt(100000); // 1000 ENRG tokens
      depositUuid = generateUUID(await taskOwner.getAddress());
      recipientUuid = generateUUID(assistant.address);
      await energyToken
        .connect(taskOwner)
        .approve(await energyEscrow.getAddress(), depositAmount);
      await energyEscrow.connect(taskOwner).deposit(depositUuid, depositAmount);
      await energyEscrow
        .connect(owner)
        .setAmounts(depositUuid, 0, depositAmount, assistantNumber);

    });
    it("Should allow setting refundable, claimable amounts, and assistant count", async () => {
      const deposit = await energyEscrow.viewDeposit(depositUuid);
      expect(deposit.claimableAmount).to.equal(0);
      expect(deposit.refundableAmount).to.equal(depositAmount);
      expect(deposit.assistantCount).to.equal(assistantNumber);
    });

    it("Should allow setting the refund flag", async () => {
      await energyEscrow.connect(owner).setAllowRefund(depositUuid, false);
      const deposit = await energyEscrow.viewDeposit(depositUuid);
      expect(deposit.allowRefund).to.be.false;
    });

    it("Should allow adding the recipient", async () => {
      await energyEscrow.addRecipient(
        depositUuid,
        assistant.address,
        recipientUuid
      );
      const deposit = await energyEscrow.viewDeposit(depositUuid);
      expect(deposit[5]).to.be.equal(assistantNumber);
    });

    it("Should allow setting the claimable/claimed flag toggle", async () => {
      await energyEscrow.addRecipient(
        depositUuid,
        assistant.address,
        recipientUuid
      );
      await energyEscrow.setClaimable(depositUuid, recipientUuid);
      await energyEscrow.setAmounts(
        depositUuid,
        depositAmount,
        0,
        assistantNumber
      );

      await energyEscrow.connect(assistant).claim(depositUuid, recipientUuid);
      const deposit = await energyEscrow.viewDepositRecipient(
        depositUuid,
        recipientUuid
      );
      expect(deposit[1]).to.be.equal(true);
      expect(deposit[2]).to.be.equal(true);
    });

    it("Should allow the assistant to claim the amount", async () => {
      await energyEscrow.addRecipient(
        depositUuid,
        assistant.address,
        recipientUuid
      );
      await energyEscrow.setClaimable(depositUuid, recipientUuid);
      await energyEscrow.setAmounts(
        depositUuid,
        depositAmount,
        0,
        assistantNumber
      );

      await energyEscrow.connect(assistant).claim(depositUuid, recipientUuid);
      const deposit = await energyEscrow.viewDepositRecipient(
        depositUuid,
        recipientUuid
      );
      expect(deposit[1]).to.be.equal(true);
      expect(deposit[2]).to.be.equal(true);
      expect(await energyToken.balanceOf(assistant)).to.be.equal(depositAmount);
    });
  });

  describe("Multiplicity Tasks", async () => {
    let owner: HardhatEthersSigner,
      taskOwner: HardhatEthersSigner,
      assistant: HardhatEthersSigner,
      assistant2: HardhatEthersSigner,
      depositUuid: string,
      depositAmount: any,
      assistant3: HardhatEthersSigner,
      assistant4: HardhatEthersSigner,
      assistant5: HardhatEthersSigner;
    let recipientUuid1: string,
      recipientUuid2: string,
      recipientUuid3: string,
      recipientUuid4: string,
      recipientUuid5: string;
    let enrgPerTask: bigint;
    const assistantNumber = 4;
    // Common setup for the deposit tests
    beforeEach(async () => {
      ({
        owner,
        taskOwner,
        assistant,
        assistant2,
        assistant3,
        assistant4,
        assistant5,
      } = await loadFixture(deployFixture));
      enrgPerTask = BigInt(1000);
      depositAmount = enrgPerTask * BigInt(assistantNumber); // 1000 ENRG tokens
      depositUuid = generateUUID(await taskOwner.getAddress());

      recipientUuid1 = generateUUID(assistant.address);
      recipientUuid2 = generateUUID(assistant2.address);
      recipientUuid3 = generateUUID(assistant3.address);
      recipientUuid4 = generateUUID(assistant4.address);
      recipientUuid5 = generateUUID(assistant5.address);

      await energyToken
        .connect(taskOwner)
        .approve(await energyEscrow.getAddress(), depositAmount);
      await energyEscrow.connect(taskOwner).deposit(depositUuid, depositAmount);
      await energyEscrow
        .connect(owner)
        .setAmounts(depositUuid, enrgPerTask, depositAmount, assistantNumber);
    });

    it("Should allow setting refundable, claimable amounts, and assistant count", async () => {
      const deposit = await energyEscrow.viewDeposit(depositUuid);
      expect(deposit.claimableAmount).to.equal(enrgPerTask);
      expect(deposit.refundableAmount).to.equal(depositAmount);
      expect(deposit.assistantCount).to.equal(assistantNumber);
    });

    it("Should allow setting the refund flag", async () => {
      await energyEscrow.connect(owner).setAllowRefund(depositUuid, false);
      const deposit = await energyEscrow.viewDeposit(depositUuid);
      expect(deposit.allowRefund).to.be.false;
    });

    it("Should disallow the owner to refund the ENRG if the task was already accepted before", async()=>{

    })

    it("Should allow adding multiple recipients", async () => {
      await energyEscrow.addRecipient(
        depositUuid,
        assistant.address,
        recipientUuid1
      );
      await energyEscrow.addRecipient(
        depositUuid,
        assistant2.address,
        recipientUuid2
      );
      await energyEscrow.addRecipient(
        depositUuid,
        assistant3.address,
        recipientUuid3
      );
      await energyEscrow.addRecipient(
        depositUuid,
        assistant4.address,
        recipientUuid4
      );

      const deposit = await energyEscrow.viewDeposit(depositUuid);
      expect(deposit[5]).to.be.equal(assistantNumber);
    });

    it("Should disallow adding recipients when at max capacity", async () => {
      await energyEscrow.addRecipient(
        depositUuid,
        assistant.address,
        recipientUuid1
      );
      await energyEscrow.addRecipient(
        depositUuid,
        assistant2.address,
        recipientUuid2
      );
      await energyEscrow.addRecipient(
        depositUuid,
        assistant3.address,
        recipientUuid3
      );
      await energyEscrow.addRecipient(
        depositUuid,
        assistant4.address,
        recipientUuid4
      );

      await expect(
        energyEscrow.addRecipient(
          depositUuid,
          assistant5.address,
          recipientUuid5
        )
      ).to.be.revertedWith(
        "EnergyEscrow::addRecipient: Recipients cannot exceed the assistant count"
      );

      const deposit = await energyEscrow.viewDeposit(depositUuid);
      expect(deposit[5]).to.be.equal(assistantNumber);
    });

    it("Should allow setting the claimable/claimed flag toggle", async () => {
      await energyEscrow.addRecipient(
        depositUuid,
        assistant.address,
        recipientUuid1
      );
      await energyEscrow.setClaimable(depositUuid, recipientUuid1);

      await energyEscrow.connect(assistant).claim(depositUuid, recipientUuid1);
      const depositRecipient = await energyEscrow.viewDepositRecipient(
        depositUuid,
        recipientUuid1
      );
      expect(depositRecipient[1]).to.be.equal(true);
      expect(depositRecipient[2]).to.be.equal(true);
    });

    it("Should allow one assistant to claim the amount", async () => {
      await energyEscrow.addRecipient(
        depositUuid,
        assistant.address,
        recipientUuid1
      );
      await energyEscrow.setClaimable(depositUuid, recipientUuid1);
      const depositBef = await energyEscrow.viewDeposit(depositUuid);
      await energyEscrow.connect(assistant).claim(depositUuid, recipientUuid1);
      const depositAft = await energyEscrow.viewDeposit(depositUuid);
      expect(await energyToken.balanceOf(assistant)).to.be.equal(enrgPerTask);
      expect(depositAft[1]).to.be.equal(depositBef[1] - enrgPerTask);
      expect(depositAft[1]).to.be.equal(depositAft[3]);
    });

    it("Should allow all assistants to claim the amount", async () => {
      //Adding recipients
      await energyEscrow.addRecipient(
        depositUuid,
        assistant.address,
        recipientUuid1
      );
      await energyEscrow.addRecipient(
        depositUuid,
        assistant2.address,
        recipientUuid2
      );
      await energyEscrow.addRecipient(
        depositUuid,
        assistant3.address,
        recipientUuid3
      );
      await energyEscrow.addRecipient(
        depositUuid,
        assistant4.address,
        recipientUuid4
      );

      //Setting the recipient entry to claimable state
      await energyEscrow.setClaimable(depositUuid, recipientUuid1);
      await energyEscrow.setClaimable(depositUuid, recipientUuid2);
      await energyEscrow.setClaimable(depositUuid, recipientUuid3);
      await energyEscrow.setClaimable(depositUuid, recipientUuid4);

      // Simulate assistant claiming
      await energyEscrow.connect(assistant).claim(depositUuid, recipientUuid1);
      await energyEscrow.connect(assistant2).claim(depositUuid, recipientUuid2);
      await energyEscrow.connect(assistant3).claim(depositUuid, recipientUuid3);
      await energyEscrow.connect(assistant4).claim(depositUuid, recipientUuid4);

      //Checking assistant balance
      expect(await energyToken.balanceOf(assistant)).to.be.equal(enrgPerTask);
      expect(await energyToken.balanceOf(assistant2)).to.be.equal(enrgPerTask);
      expect(await energyToken.balanceOf(assistant3)).to.be.equal(enrgPerTask);
      expect(await energyToken.balanceOf(assistant4)).to.be.equal(enrgPerTask);

      //Check contract deposit
      const deposit = await energyEscrow.viewDeposit(depositUuid);
      expect(deposit[1]).to.be.equal(BigInt(0));
      expect(deposit[3]).to.be.equal(BigInt(0));
    });


    //Task Edit START
    it("Should allow owner to reduce the max assignment", async()=>{
      const deposit = energyEscrow.viewDeposit(depositUuid);
      const ownerBeforeBalance = await energyToken.balanceOf(taskOwner);
      


      
    })
    
    it("Should refund the owner upon reducing the max assignment", async()=>{

    })

    it("Should allow the owner to add the max assignment", async()=>{
      
    })

    it("Should automatically compensate assistants that already claimed their reward when adding the max assignment", async()=>{
      
    })

    it("Should allow owner to adjust the energy", async()=>{
      
    })

    it("Should allow owner to adjust the energy", async()=>{
      
    })

    it("Should allow owner to adjust the energy", async()=>{
      
    })

    //Task Edit END
  });

});
