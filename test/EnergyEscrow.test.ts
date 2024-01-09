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

  describe("Deposits", async () => {
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
      const newDepositUuid = generateUUID(await taskOwner.getAddress());
      const newDepositAmt = BigInt(10000); //100 ENRG tokens
      await energyToken
        .connect(taskOwner)
        .approve(await energyEscrow.getAddress(), depositAmount);
      await energyEscrow
        .connect(taskOwner)
        .deposit(newDepositUuid, depositAmount);

      const deposit = await energyEscrow.viewDeposit(newDepositUuid);

      expect(deposit[0]).to.be.equal(await taskOwner.getAddress()); //Depositor address
      expect(deposit[1]).to.be.equal(newDepositAmt);
    });
    it("Should allow the contract owner to refund when the flag is set to true", async () => {
      await energyEscrow.setAllowRefund(depositUuid, true);
      await energyEscrow.refund(depositUuid);
      const deposit = await energyEscrow.viewDeposit(depositUuid);
      expect(deposit[1]).to.be.equal(0); //Amount
      expect(deposit[2]).to.be.equal(0); //Claimable
      expect(deposit[3]).to.be.equal(0); //Refundable
    });

    it("Should disallow the contract owner to refund when the flag is set to false", async () => {
      await energyEscrow.setAllowRefund(depositUuid, false);
      await expect(energyEscrow.refund(depositUuid)).revertedWith(
        "EnergyEscrow::refund: The deposit should be refundable"
      );
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

    it.only("Should allow setting the refund flag", async () => {
      // Set the allow refund flag for the specified deposit
      await energyEscrow.connect(owner).setAllowRefund(depositUuid, false);
  
      // Retrieve the updated deposit details
      const deposit = await energyEscrow.viewDeposit(depositUuid);
  
      // Assert that the allowRefund flag in the deposit is set as expected
      expect(deposit.allowRefund, "Deposit's allowRefund flag should be set to false").to.be.false;
    });
  

    it("Should allow adding a recipient", async () => {
      // Add the assistant as a recipient to the specified deposit
      await energyEscrow.addRecipient(depositUuid, assistant.address, recipientUuid);
  
      // Retrieve the updated deposit details
      const deposit = await energyEscrow.viewDeposit(depositUuid);
  
      // Assert that the number of recipients for the deposit is as expected
      expect(deposit[5], "Number of recipients in the deposit should match the expected value").to.equal(assistantNumber);
    });
  

    it("Should allow setting the claimable/claimed flag toggle", async () => {
      // Add the assistant as a recipient to the deposit
      await energyEscrow.addRecipient(depositUuid, assistant.address, recipientUuid);
  
      // Set the deposit as claimable for the assistant
      await energyEscrow.setClaimable(depositUuid, recipientUuid);
  
      // Set the deposit amounts and assistant number
      await energyEscrow.setAmounts(depositUuid, depositAmount, 0, assistantNumber);
  
      // Assistant claims the deposit
      await energyEscrow.connect(assistant).claim(depositUuid, recipientUuid);
  
      // Retrieve deposit details for the recipient
      const deposit = await energyEscrow.viewDepositRecipient(depositUuid, recipientUuid);
  
      // Assert that the recipient's claimable and claimed flags are set to true
      expect(deposit[1], "Recipient should be marked as claimable").to.be.true;
      expect(deposit[2], "Recipient should be marked as claimed").to.be.true;
  });
  

    it("Should allow the assistant to claim the amount", async () => {
      // Add the assistant as a recipient to the deposit
      await energyEscrow.addRecipient(depositUuid, assistant.address, recipientUuid);
  
      // Set the deposit as claimable for the assistant
      await energyEscrow.setClaimable(depositUuid, recipientUuid);
  
      // Set the deposit amounts and assistant number
      await energyEscrow.setAmounts(depositUuid, depositAmount, 0, assistantNumber);
  
      // Assistant claims the deposit
      await energyEscrow.connect(assistant).claim(depositUuid, recipientUuid);
  
      // Retrieve deposit details for the recipient
      const deposit = await energyEscrow.viewDepositRecipient(depositUuid, recipientUuid);
  
      // Assert that the recipient's claimable and claimed flags are true
      expect(deposit[1], "Recipient should be marked as claimable").to.be.true;
      expect(deposit[2], "Recipient should be marked as claimed").to.be.true;
  
      // Assert that the assistant's balance is equal to the deposit amount
      expect(await energyToken.balanceOf(assistant.address), "Assistant's balance should equal the deposit amount").to.equal(depositAmount);
    });
  

    it("Should allow the contract owner to refund a deposit", async () => {
      // Trigger the refund operation on the specified deposit
      await energyEscrow.refund(depositUuid);

      // Retrieve the details of the deposit after refund operation
      const deposit = await energyEscrow.viewDeposit(depositUuid);

      expect(deposit[0], "Deposited amount should be 0 after refund").to.equal(
        0
      );
      expect(
        deposit[1],
        "Another relevant deposit field should be 0 after refund"
      ).to.equal(0);
      expect(
        deposit[2],
        "Yet another relevant deposit field should be 0 after refund"
      ).to.equal(0);
    });

    it("Should allow the contract owner to delete a deposit", async () => {
      // Perform the refund operation before attempting to delete the deposit
      await energyEscrow.connect(taskOwner).refund(depositUuid);

      // Delete the deposit
      await energyEscrow.deleteDeposit(depositUuid);

      // Retrieve the deleted deposit data
      const deletedDeposit = await energyEscrow.viewDeposit(depositUuid);

      // Check that the deposit has been properly deleted by confirming the depositor address is the zero address
      expect(deletedDeposit[0]).to.equal(
        "0x0000000000000000000000000000000000000000"
      );
    });

    it("Should disallow the contract owner to delete a deposit when there's still an amount left", async () => {
      // Attempt to delete the deposit and expect it to be reverted due to remaining balance
      await expect(energyEscrow.deleteDeposit(depositUuid)).to.be.revertedWith(
        "There's still an amount left in the deposit"
      );
    });

    describe("Refunds", async () => {
      it("Should allow the contract owner to refund a deposit without any recipients", async () => {
        await energyEscrow.refund(depositUuid);
        const deposit = await energyEscrow.viewDeposit(depositUuid);

        expect(deposit[1]).to.be.equal(0); //Amount
        expect(deposit[2]).to.be.equal(0); //Claimable
        expect(deposit[3]).to.be.equal(0); //Refundable
        expect(deposit[5]).to.be.equal(0); //Recipient Length (number of recipients)
      });

      it("Should disallow the contract owner to refund a deposit when there's a recipient already", async () => {
        await energyEscrow.addRecipient(
          depositUuid,
          assistant.address,
          recipientUuid
        );
        await energyEscrow.setAmounts(
          depositUuid,
          depositAmount,
          0,
          assistantNumber
        );

        await expect(
          energyEscrow.connect(taskOwner).refund(depositUuid)
        ).revertedWith(
          "EnergyEscrow::refund: There should be no recipients to be eligible for a refund"
        );
      });

      it("Should disallow the contract owner to refund when it was accepted previously", async () => {
        await energyEscrow.addRecipient(
          depositUuid,
          assistant.address,
          recipientUuid
        );
        await energyEscrow.setAmounts(
          depositUuid,
          depositAmount,
          0,
          assistantNumber
        );
        await energyEscrow.removeRecipient(depositUuid, recipientUuid);

        await expect(
          energyEscrow.connect(taskOwner).refund(depositUuid)
        ).revertedWith(
          "EnergyEscrow::refund: Cannot refund as the task was previously accepted by an assistant"
        );
      });

      //TODO: Implement test case for forced refunds.
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

    it("Should disallow the owner to refund the ENRG if the task was already accepted before", async () => {});

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

    describe("Refunds", async () => {
      it("Should allow the contract owner to refund a deposit without any recipients", async () => {
        await energyEscrow.refund(depositUuid);
        const deposit = await energyEscrow.viewDeposit(depositUuid);

        expect(deposit[1]).to.be.equal(0); //Amount
        expect(deposit[2]).to.be.equal(0); //Claimable
        expect(deposit[3]).to.be.equal(0); //Refundable
        expect(deposit[5]).to.be.equal(0); //Recipient Length (number of recipients)
      });

      it("Should disallow the contract owner to refund a deposit when there's a recipient already", async () => {
        await energyEscrow.addRecipient(
          depositUuid,
          assistant.address,
          recipientUuid
        );
        await energyEscrow.setAmounts(
          depositUuid,
          depositAmount,
          0,
          assistantNumber
        );

        await expect(
          energyEscrow.connect(taskOwner).refund(depositUuid)
        ).revertedWith(
          "EnergyEscrow::refund: There should be no recipients to be eligible for a refund"
        );
      });

      it("Should disallow the contract owner to refund when it was accepted previously", async () => {
        await energyEscrow.addRecipient(
          depositUuid,
          assistant.address,
          recipientUuid
        );
        await energyEscrow.setAmounts(
          depositUuid,
          depositAmount,
          0,
          assistantNumber
        );
        await energyEscrow.removeRecipient(depositUuid, recipientUuid);

        await expect(
          energyEscrow.connect(taskOwner).refund(depositUuid)
        ).revertedWith(
          "EnergyEscrow::refund: Cannot refund as the task was previously accepted by an assistant"
        );
      });

      //TODO: Implement test case for forced refunds.
    });

    describe("Task Edit", async () => {
      it("Should allow owner to reduce the max assignment", async () => {
        const deposit = energyEscrow.viewDeposit(depositUuid);
        const ownerBeforeBalance = await energyToken.balanceOf(taskOwner);
      });

      it("Should refund the owner upon reducing the max assignment", async () => {});

      it("Should allow the owner to add the max assignment", async () => {});

      it("Should automatically compensate assistants that already claimed their reward when adding the max assignment", async () => {});

      it("Should allow owner to adjust the energy", async () => {});

      it("Should allow owner to adjust the energy", async () => {});

      it("Should allow owner to adjust the energy", async () => {});
    });

    //Task Edit START

    //Task Edit END
  });
});
