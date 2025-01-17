import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {EstforTypes, EstforConstants} from "@paintswap/estfor-definitions";
import {Attire, Skill, defaultActionChoice, defaultActionInfo} from "@paintswap/estfor-definitions/types";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {ethers} from "hardhat";
import {AvatarInfo, createPlayer} from "../../scripts/utils";
import {getActionChoiceId, getActionId, GUAR_MUL, RATE_MUL, SPAWN_MUL, START_XP} from "../utils";
import {playersFixture} from "./PlayersFixture";
import {getXPFromLevel, setupBasicFiremaking, setupBasicFishing, setupBasicWoodcutting, setupTravelling} from "./utils";
import {Players} from "../../typechain-types";

const actionIsAvailable = true;

describe("Players", function () {
  this.retries(3);

  it("New player stats", async function () {
    const {players, playerNFT, alice} = await loadFixture(playersFixture);

    const avatarId = 2;
    const avatarInfo: AvatarInfo = {
      name: "Name goes here",
      description: "Hi I'm a description",
      imageURI: "1234.png",
      startSkills: [Skill.FIREMAKING, Skill.NONE],
    };
    await playerNFT.setAvatars(avatarId, [avatarInfo]);
    const playerId = await createPlayer(playerNFT, avatarId, alice, "Name", true);

    expect(await players.xp(playerId, Skill.FIREMAKING)).to.eq(START_XP);

    avatarInfo.startSkills = [Skill.FIREMAKING, Skill.HEALTH];

    await playerNFT.setAvatars(avatarId, [avatarInfo]);
    const newPlayerId = await createPlayer(playerNFT, avatarId, alice, "New name", true);
    expect(await players.xp(newPlayerId, Skill.FIREMAKING)).to.eq(START_XP / 2);
    expect(await players.xp(newPlayerId, Skill.HEALTH)).to.eq(START_XP / 2);
    expect((await players.players(newPlayerId)).totalXP).to.eq(START_XP);
  });

  it("Skill points", async function () {
    const {playerId, players, itemNFT, world, alice} = await loadFixture(playersFixture);
    const {queuedAction} = await setupBasicWoodcutting(itemNFT, world);
    await players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE);
    await ethers.provider.send("evm_increaseTime", [361]);
    await players.connect(alice).processActions(playerId);
    expect(await players.xp(playerId, EstforTypes.Skill.WOODCUTTING)).to.eq(360);
    expect(await itemNFT.balanceOf(alice.address, EstforConstants.LOG)).to.eq(10); // Should be rounded down
    expect((await players.players(playerId)).totalXP).to.eq(START_XP + 360);
  });

  it("Skill points (many)", async function () {
    const {playerId, players, itemNFT, world, alice} = await loadFixture(playersFixture);
    const {queuedAction} = await setupBasicWoodcutting(itemNFT, world);
    // start a bunch of actions 1 after each other
    for (let i = 0; i < 50; ++i) {
      await players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.APPEND);
      await ethers.provider.send("evm_increaseTime", [7200]);
      await players.connect(alice).processActions(playerId);
      expect(await players.xp(playerId, EstforTypes.Skill.WOODCUTTING)).to.be.eq((i + 1) * 3600);
      expect(await itemNFT.balanceOf(alice.address, EstforConstants.LOG)).to.eq((i + 1) * 100); // Should be rounded down
    }
  });

  it("Partial consume aux items", async function () {
    const {playerId, players, itemNFT, world, alice} = await loadFixture(playersFixture);
    const {queuedAction, rate} = await setupBasicWoodcutting(itemNFT, world);
    await players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE);

    await ethers.provider.send("evm_increaseTime", [queuedAction.timespan / 2]);
    await players.connect(alice).processActions(playerId);
    expect(await players.xp(playerId, EstforTypes.Skill.WOODCUTTING)).to.be.deep.oneOf([
      BigNumber.from(queuedAction.timespan / 2),
      BigNumber.from(queuedAction.timespan / 2 + 1),
    ]);
    // Check the drops are as expected
    expect(await itemNFT.balanceOf(alice.address, EstforConstants.LOG)).to.eq(
      Math.floor(((queuedAction.timespan / 2) * rate) / (3600 * GUAR_MUL))
    );
  });

  it("Skill points, max range", async function () {
    const {playerId, players, itemNFT, world, alice} = await loadFixture(playersFixture);
    const {queuedAction} = await setupBasicWoodcutting(itemNFT, world);
    await players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE);

    await ethers.provider.send("evm_increaseTime", [queuedAction.timespan]);
    await players.connect(alice).processActions(playerId);
    expect(await players.xp(playerId, EstforTypes.Skill.WOODCUTTING)).to.eq(queuedAction.timespan);
  });

  it("Multi-skill points", async function () {
    // TODO:
  });

  // TODO: Check attire stats are as expected
  it("Attire equipPositions", async function () {
    const {playerId, players, itemNFT, world, alice} = await loadFixture(playersFixture);

    let tx = await world.addActions([
      {
        actionId: 1,
        info: {
          ...defaultActionInfo,
          skill: EstforTypes.Skill.COMBAT,
          xpPerHour: 3600,
          minXP: 0,
          isDynamic: false,
          numSpawned: 1 * SPAWN_MUL,
          handItemTokenIdRangeMin: EstforConstants.COMBAT_BASE,
          handItemTokenIdRangeMax: EstforConstants.COMBAT_MAX,
          isAvailable: actionIsAvailable,
          actionChoiceRequired: true,
          successPercent: 100,
        },
        guaranteedRewards: [],
        randomRewards: [],
        combatStats: EstforTypes.emptyCombatStats,
      },
    ]);
    const actionId = await getActionId(tx);

    tx = await world.addBulkActionChoices(
      [EstforConstants.NONE],
      [[1]],
      [
        [
          {
            ...defaultActionChoice,
            skill: EstforTypes.Skill.MELEE,
          },
        ],
      ]
    );
    const choiceId = await getActionChoiceId(tx);
    const timespan = 3600;

    const queuedAction: EstforTypes.QueuedActionInput = {
      attire: {...EstforTypes.noAttire, head: EstforConstants.BRONZE_GAUNTLETS}, // Incorrect attire
      actionId,
      combatStyle: EstforTypes.CombatStyle.ATTACK,
      choiceId,
      regenerateId: EstforConstants.NONE,
      timespan,
      rightHandEquipmentTokenId: EstforConstants.NONE,
      leftHandEquipmentTokenId: EstforConstants.NONE,
    };

    await itemNFT.addItems([
      {
        ...EstforTypes.defaultItemInput,
        tokenId: EstforConstants.BRONZE_GAUNTLETS,
        combatStats: EstforTypes.emptyCombatStats,
        equipPosition: EstforTypes.EquipPosition.ARMS,
      },
    ]);
    await itemNFT.testMint(alice.address, EstforConstants.BRONZE_GAUNTLETS, 1);

    await expect(
      players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE)
    ).to.be.revertedWithCustomError(players, "InvalidEquipPosition");
    queuedAction.attire.head = EstforConstants.NONE;
    queuedAction.attire.neck = EstforConstants.BRONZE_GAUNTLETS;
    await expect(
      players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE)
    ).to.be.revertedWithCustomError(players, "InvalidEquipPosition");
    queuedAction.attire.neck = EstforConstants.NONE;
    queuedAction.attire.body = EstforConstants.BRONZE_GAUNTLETS;
    await expect(
      players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE)
    ).to.be.revertedWithCustomError(players, "InvalidEquipPosition");
    queuedAction.attire.body = EstforConstants.NONE;
    queuedAction.attire.feet = EstforConstants.BRONZE_GAUNTLETS;
    await expect(
      players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE)
    ).to.be.revertedWithCustomError(players, "InvalidEquipPosition");
    queuedAction.attire.feet = EstforConstants.NONE;
    queuedAction.attire.legs = EstforConstants.BRONZE_GAUNTLETS;
    await expect(
      players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE)
    ).to.be.revertedWithCustomError(players, "InvalidEquipPosition");
    queuedAction.attire.legs = EstforConstants.NONE;
    queuedAction.attire.arms = EstforConstants.BRONZE_GAUNTLETS; // Correct
    await players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE);
  });

  it("validateActions", async function () {
    const {playerId, players, itemNFT, world, alice} = await loadFixture(playersFixture);

    let tx = await world.addActions([
      {
        actionId: 1,
        info: {
          ...defaultActionInfo,
          skill: EstforTypes.Skill.COMBAT,
          xpPerHour: 3600,
          minXP: 0,
          isDynamic: false,
          numSpawned: 1 * SPAWN_MUL,
          handItemTokenIdRangeMin: EstforConstants.COMBAT_BASE,
          handItemTokenIdRangeMax: EstforConstants.COMBAT_MAX,
          isAvailable: actionIsAvailable,
          actionChoiceRequired: true,
          successPercent: 100,
        },
        guaranteedRewards: [],
        randomRewards: [],
        combatStats: EstforTypes.emptyCombatStats,
      },
    ]);
    const actionId = await getActionId(tx);

    tx = await world.addBulkActionChoices(
      [EstforConstants.NONE],
      [[1]],
      [
        [
          {
            ...defaultActionChoice,
            skill: EstforTypes.Skill.MELEE,
          },
        ],
      ]
    );
    const choiceId = await getActionChoiceId(tx);
    const timespan = 3600;

    const queuedAction: EstforTypes.QueuedActionInput = {
      attire: {...EstforTypes.noAttire, head: EstforConstants.BRONZE_GAUNTLETS}, // Incorrect attire
      actionId,
      combatStyle: EstforTypes.CombatStyle.ATTACK,
      choiceId,
      regenerateId: EstforConstants.NONE,
      timespan,
      rightHandEquipmentTokenId: EstforConstants.NONE,
      leftHandEquipmentTokenId: EstforConstants.NONE,
    };

    await itemNFT.addItems([
      {
        ...EstforTypes.defaultItemInput,
        tokenId: EstforConstants.BRONZE_GAUNTLETS,
        combatStats: EstforTypes.emptyCombatStats,
        equipPosition: EstforTypes.EquipPosition.ARMS,
      },
    ]);
    await itemNFT.testMint(alice.address, EstforConstants.BRONZE_GAUNTLETS, 1);

    const queuedActionCorrect = {...queuedAction, attire: {...EstforTypes.noAttire}};

    await expect(
      players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE)
    ).to.be.revertedWithCustomError(players, "InvalidEquipPosition");

    let {successes, reasons} = await players
      .connect(alice)
      .validateActions(alice.address, playerId, [queuedAction, queuedActionCorrect, queuedAction]);

    const InvalidEquipPositionSelector = "0x9378eb35";
    expect(successes.length).to.eq(3);
    expect(reasons.length).to.eq(3);
    expect(successes[0]).to.eq(false);
    expect(reasons[0]).to.eq(InvalidEquipPositionSelector);
    expect(successes[1]).to.eq(true);
    expect(reasons[1]).to.eq("0x");
    expect(successes[2]).to.eq(false);
    expect(reasons[2]).to.eq(InvalidEquipPositionSelector);

    ({successes, reasons} = await players
      .connect(alice)
      .validateActions(alice.address, playerId, [queuedActionCorrect]));

    expect(successes.length).to.eq(1);
    expect(reasons.length).to.eq(1);
    expect(successes[0]).to.eq(true);
    expect(reasons[0]).to.eq("0x");

    ({successes, reasons} = await players.connect(alice).validateActions(alice.address, playerId, [queuedAction]));

    expect(successes.length).to.eq(1);
    expect(reasons.length).to.eq(1);
    expect(successes[0]).to.eq(false);
    expect(reasons[0]).to.eq(InvalidEquipPositionSelector);
  });

  it("Queueing after 1 action is completely finished", async function () {
    const {playerId, players, itemNFT, world, alice} = await loadFixture(playersFixture);
    const {queuedAction} = await setupBasicWoodcutting(itemNFT, world);
    await players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE);
    await ethers.provider.send("evm_increaseTime", [queuedAction.timespan / 2]);
    await players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.APPEND);
    let actionQueue = await players.getActionQueue(playerId);
    expect(actionQueue.length).to.eq(2);
    await ethers.provider.send("evm_increaseTime", [queuedAction.timespan / 2 + 1]); // First one is now finished
    await players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.APPEND); // This should complete the first one
    actionQueue = await players.getActionQueue(playerId);
    expect(actionQueue.length).to.eq(2);
    expect(actionQueue[0].queueId).to.eq(2);
    expect(actionQueue[0].timespan).to.be.oneOf([
      queuedAction.timespan - 2,
      queuedAction.timespan - 1,
      queuedAction.timespan,
    ]);
    expect(actionQueue[1].queueId).to.eq(3);
    expect(actionQueue[1].timespan).to.eq(queuedAction.timespan);
  });

  describe("Queue combinations", function () {
    it("Remove in-progress but keep 1 pending", async function () {
      const {playerId, players, itemNFT, world, alice} = await loadFixture(playersFixture);
      const {queuedAction} = await setupBasicWoodcutting(itemNFT, world);
      await players
        .connect(alice)
        .startActions(playerId, [queuedAction, queuedAction], EstforTypes.ActionQueueStatus.NONE);
      await ethers.provider.send("evm_increaseTime", [queuedAction.timespan / 2]);
      let actionQueue = await players.getActionQueue(playerId);
      expect(actionQueue.length).to.eq(2);
      await players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE);
      actionQueue = await players.getActionQueue(playerId);
      expect(actionQueue.length).to.eq(1);
      expect(actionQueue[0].queueId).to.eq(3);
      expect(actionQueue[0].timespan).to.eq(queuedAction.timespan);
    });
    it("Remove in-progress but keep pending, add another pending", async function () {
      const {playerId, players, itemNFT, world, alice} = await loadFixture(playersFixture);
      const {queuedAction} = await setupBasicWoodcutting(itemNFT, world);
      await players
        .connect(alice)
        .startActions(playerId, [queuedAction, queuedAction], EstforTypes.ActionQueueStatus.NONE);
      await ethers.provider.send("evm_increaseTime", [queuedAction.timespan / 2]);
      let actionQueue = await players.getActionQueue(playerId);
      expect(actionQueue.length).to.eq(2);
      await players
        .connect(alice)
        .startActions(playerId, [queuedAction, queuedAction], EstforTypes.ActionQueueStatus.NONE);
      actionQueue = await players.getActionQueue(playerId);
      expect(actionQueue.length).to.eq(2);
      expect(actionQueue[0].queueId).to.eq(3);
      expect(actionQueue[0].timespan).to.eq(queuedAction.timespan);
      expect(actionQueue[1].queueId).to.eq(4);
      expect(actionQueue[1].timespan).to.eq(queuedAction.timespan);
    });
    it("Keep in-progress, remove 1 pending", async function () {
      const {playerId, players, itemNFT, world, alice} = await loadFixture(playersFixture);
      const {queuedAction} = await setupBasicWoodcutting(itemNFT, world);
      await players
        .connect(alice)
        .startActions(playerId, [queuedAction, queuedAction], EstforTypes.ActionQueueStatus.NONE);
      await ethers.provider.send("evm_increaseTime", [queuedAction.timespan / 2]);
      let actionQueue = await players.getActionQueue(playerId);
      expect(actionQueue.length).to.eq(2);
      await players.connect(alice).startActions(playerId, [], EstforTypes.ActionQueueStatus.KEEP_LAST_IN_PROGRESS);
      actionQueue = await players.getActionQueue(playerId);
      expect(actionQueue.length).to.eq(1);
      expect(actionQueue[0].queueId).to.eq(1);
      expect(actionQueue[0].timespan).to.be.oneOf([queuedAction.timespan / 2 - 1, queuedAction.timespan / 2]);
    });
    it("Keep in-progress, remove 1 pending, and add 1 pending", async function () {
      const {playerId, players, itemNFT, world, alice} = await loadFixture(playersFixture);
      const {queuedAction} = await setupBasicWoodcutting(itemNFT, world);
      await players
        .connect(alice)
        .startActions(playerId, [queuedAction, queuedAction], EstforTypes.ActionQueueStatus.NONE);
      await ethers.provider.send("evm_increaseTime", [queuedAction.timespan / 2]);
      let actionQueue = await players.getActionQueue(playerId);
      expect(actionQueue.length).to.eq(2);
      await players
        .connect(alice)
        .startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.KEEP_LAST_IN_PROGRESS);
      actionQueue = await players.getActionQueue(playerId);
      expect(actionQueue.length).to.eq(2);
      expect(actionQueue[0].queueId).to.eq(1);
      expect(actionQueue[0].timespan).to.be.oneOf([queuedAction.timespan / 2 - 1, queuedAction.timespan / 2]);
      expect(actionQueue[1].queueId).to.eq(3);
      expect(actionQueue[1].timespan).to.eq(queuedAction.timespan);
    });
    it("Remove in-progress and any pending", async function () {
      const {playerId, players, itemNFT, world, alice} = await loadFixture(playersFixture);
      const {queuedAction} = await setupBasicWoodcutting(itemNFT, world);
      await players
        .connect(alice)
        .startActions(playerId, [queuedAction, queuedAction], EstforTypes.ActionQueueStatus.NONE);
      await ethers.provider.send("evm_increaseTime", [queuedAction.timespan / 2]);
      let actionQueue = await players.getActionQueue(playerId);
      expect(actionQueue.length).to.eq(2);
      await players.connect(alice).startActions(playerId, [], EstforTypes.ActionQueueStatus.NONE);
      actionQueue = await players.getActionQueue(playerId);
      expect(actionQueue.length).to.eq(0);
    });
    it("Remove in-progress and pending, add 1 pending ", async function () {
      const {playerId, players, itemNFT, world, alice} = await loadFixture(playersFixture);
      const {queuedAction} = await setupBasicWoodcutting(itemNFT, world);
      await players
        .connect(alice)
        .startActions(playerId, [queuedAction, queuedAction], EstforTypes.ActionQueueStatus.NONE);
      await ethers.provider.send("evm_increaseTime", [queuedAction.timespan / 2]);
      let actionQueue = await players.getActionQueue(playerId);
      expect(actionQueue.length).to.eq(2);
      await players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE);
      actionQueue = await players.getActionQueue(playerId);
      expect(actionQueue.length).to.eq(1);
      expect(actionQueue[0].queueId).to.eq(3);
      expect(actionQueue[0].timespan).to.eq(queuedAction.timespan);
    });
    it("Append and pending, add another pending", async function () {
      const {playerId, players, itemNFT, world, alice} = await loadFixture(playersFixture);
      const {queuedAction} = await setupBasicWoodcutting(itemNFT, world);
      await players
        .connect(alice)
        .startActions(playerId, [queuedAction, queuedAction], EstforTypes.ActionQueueStatus.NONE);
      await ethers.provider.send("evm_increaseTime", [queuedAction.timespan / 2]);
      let actionQueue = await players.getActionQueue(playerId);
      expect(actionQueue.length).to.eq(2);
      await players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.APPEND);
      actionQueue = await players.getActionQueue(playerId);
      expect(actionQueue.length).to.eq(3);
      expect(actionQueue[0].queueId).to.eq(1);
      expect(actionQueue[1].queueId).to.eq(2);
      expect(actionQueue[2].queueId).to.eq(3);
    });
    it("Keep in progress, action is finished, queue 3", async function () {
      const {playerId, players, itemNFT, world, alice} = await loadFixture(playersFixture);
      const {queuedAction: basicWoodcuttingQueuedAction} = await setupBasicWoodcutting(itemNFT, world);
      let actionQueue = await players.getActionQueue(playerId);
      expect(actionQueue.length).to.eq(0);
      const queuedAction = {...basicWoodcuttingQueuedAction};
      queuedAction.timespan = 14 * 3600;
      await players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE);
      await ethers.provider.send("evm_increaseTime", [queuedAction.timespan + 1]);

      queuedAction.timespan = 5 * 3600;

      actionQueue = await players.getActionQueue(playerId);
      expect(actionQueue.length).to.eq(1);
      await players
        .connect(alice)
        .startActions(
          playerId,
          [basicWoodcuttingQueuedAction, queuedAction, queuedAction],
          EstforTypes.ActionQueueStatus.KEEP_LAST_IN_PROGRESS
        );
      actionQueue = await players.getActionQueue(playerId);
      expect(actionQueue.length).to.eq(3);
      expect(actionQueue[0].queueId).to.eq(2);
      expect(actionQueue[0].timespan).to.eq(basicWoodcuttingQueuedAction.timespan);
      expect(actionQueue[1].queueId).to.eq(3);
      expect(actionQueue[1].timespan).to.eq(queuedAction.timespan);
      expect(actionQueue[2].queueId).to.eq(4);
      expect(actionQueue[2].timespan).to.eq(queuedAction.timespan);

      await ethers.provider.send("evm_increaseTime", [50]);
      await players.connect(alice).processActions(playerId);
      actionQueue = await players.getActionQueue(playerId);
      expect(actionQueue.length).to.eq(3);
      expect(actionQueue[0].queueId).to.eq(2);
      expect(actionQueue[0].timespan).to.be.oneOf([
        basicWoodcuttingQueuedAction.timespan - 50,
        basicWoodcuttingQueuedAction.timespan - 50 - 1,
      ]);
      expect(actionQueue[1].queueId).to.eq(3);
      expect(actionQueue[1].timespan).to.eq(queuedAction.timespan);
      expect(actionQueue[2].queueId).to.eq(4);
      expect(actionQueue[2].timespan).to.eq(queuedAction.timespan);
    });
  });

  describe("Minimum skill points", function () {
    it("Action", async function () {
      const {playerId, players, itemNFT, world, alice} = await loadFixture(playersFixture);
      const rate = 100 * GUAR_MUL; // per hour
      const tx = await world.addActions([
        {
          actionId: 1,
          info: {
            ...defaultActionInfo,
            skill: EstforTypes.Skill.WOODCUTTING,
            xpPerHour: 3600,
            minXP: getXPFromLevel(70),
            isDynamic: false,
            numSpawned: 0,
            handItemTokenIdRangeMin: EstforConstants.ORICHALCUM_AXE,
            handItemTokenIdRangeMax: EstforConstants.WOODCUTTING_MAX,
            isAvailable: true,
            actionChoiceRequired: false,
            successPercent: 100,
          },
          guaranteedRewards: [{itemTokenId: EstforConstants.LOG, rate}],
          randomRewards: [],
          combatStats: EstforTypes.emptyCombatStats,
        },
      ]);
      const actionId = await getActionId(tx);

      const timespan = 3600;
      const queuedAction: EstforTypes.QueuedActionInput = {
        attire: EstforTypes.noAttire,
        actionId,
        combatStyle: EstforTypes.CombatStyle.NONE,
        choiceId: EstforConstants.NONE,
        regenerateId: EstforConstants.NONE,
        timespan,
        rightHandEquipmentTokenId: EstforConstants.ORICHALCUM_AXE,
        leftHandEquipmentTokenId: EstforConstants.NONE,
      };

      await itemNFT.addItems([
        {
          ...EstforTypes.defaultItemInput,
          minXP: 0,
          tokenId: EstforConstants.ORICHALCUM_AXE,
          equipPosition: EstforTypes.EquipPosition.RIGHT_HAND,
        },
      ]);

      await itemNFT.testMint(alice.address, EstforConstants.ORICHALCUM_AXE, 1);

      await expect(
        players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE)
      ).to.be.revertedWithCustomError(players, "ActionMinimumXPNotReached");

      // Update to level 70, check it works
      await players.testModifyXP(alice.address, playerId, EstforTypes.Skill.WOODCUTTING, getXPFromLevel(70), false);
      expect(await players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE)).to
        .not.be.reverted;
    });

    describe("ActionChoices", function () {
      it("Min XP", async function () {
        const {playerId, players, itemNFT, world, alice} = await loadFixture(playersFixture);

        const minXP = getXPFromLevel(70);
        const {queuedAction} = await setupBasicFiremaking(itemNFT, world, minXP);

        await expect(
          players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE)
        ).to.be.revertedWithCustomError(players, "ActionChoiceMinimumXPNotReached");

        // Update firemamking level, check it works
        await players.testModifyXP(alice.address, playerId, EstforTypes.Skill.FIREMAKING, minXP, false);
        expect(await players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE))
          .to.not.be.reverted;

        await players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE);
      });

      it("Output number > 1", async function () {
        const {playerId, players, itemNFT, world, alice} = await loadFixture(playersFixture);
        const {queuedAction: queuedActionFiremaking, rate, actionId} = await setupBasicFiremaking(itemNFT, world, 0);

        // Logs go in, oak logs come out suprisingly!
        const outputAmount = 2;
        const tx = await world.addBulkActionChoices(
          [actionId],
          [[2]],
          [
            [
              {
                ...defaultActionChoice,
                skill: EstforTypes.Skill.FIREMAKING,
                xpPerHour: 3600,
                rate,
                inputTokenId1: EstforConstants.LOG,
                inputAmount1: 1,
                outputTokenId: EstforConstants.OAK_LOG,
                outputAmount,
              },
            ],
          ]
        );
        const choiceId = await getActionChoiceId(tx);
        const queuedAction = {...queuedActionFiremaking};
        queuedAction.choiceId = choiceId;

        // Update firemamking level, check it works
        await players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE);
        await ethers.provider.send("evm_increaseTime", [queuedAction.timespan]);
        await ethers.provider.send("evm_mine", []);

        const pendingQueuedActionState = await players.pendingQueuedActionState(alice.address, playerId);
        const expectedOutputNum = Math.floor((queuedAction.timespan * rate * outputAmount) / (3600 * RATE_MUL));
        expect(pendingQueuedActionState.equipmentStates[0].producedAmounts[0]).to.eq(expectedOutputNum);

        await players.connect(alice).processActions(playerId);
        // Check the drops are as expected
        expect(await itemNFT.balanceOf(alice.address, EstforConstants.OAK_LOG)).to.eq(expectedOutputNum);
      });
    });

    it("Consumables (food)", async function () {
      const {playerId, players, itemNFT, world, alice} = await loadFixture(playersFixture);
      const rate = 100 * RATE_MUL; // per hour
      let tx = await world.addActions([
        {
          actionId: 1,
          info: {
            ...defaultActionInfo,
            skill: EstforTypes.Skill.FIREMAKING,
            xpPerHour: 0,
            minXP: 0,
            isDynamic: false,
            numSpawned: 0,
            handItemTokenIdRangeMin: EstforConstants.MAGIC_FIRE_STARTER,
            handItemTokenIdRangeMax: EstforConstants.FIRE_MAX,
            isAvailable: actionIsAvailable,
            actionChoiceRequired: true,
            successPercent: 100,
          },
          guaranteedRewards: [],
          randomRewards: [],
          combatStats: EstforTypes.emptyCombatStats,
        },
      ]);
      const actionId = await getActionId(tx);

      // Logs go in, nothing comes out
      tx = await world.addBulkActionChoices(
        [actionId],
        [[1]],
        [
          [
            {
              ...defaultActionChoice,
              skill: EstforTypes.Skill.FIREMAKING,
              xpPerHour: 3600,
              rate,
              inputTokenId1: EstforConstants.LOG,
              inputAmount1: 1,
            },
          ],
        ]
      );
      const choiceId = await getActionChoiceId(tx);

      const timespan = 3600;
      const queuedAction: EstforTypes.QueuedActionInput = {
        attire: EstforTypes.noAttire,
        actionId,
        combatStyle: EstforTypes.CombatStyle.NONE,
        choiceId,
        regenerateId: EstforConstants.COOKED_MINNUS,
        timespan,
        rightHandEquipmentTokenId: EstforConstants.MAGIC_FIRE_STARTER,
        leftHandEquipmentTokenId: EstforConstants.NONE,
      };

      const minXP = getXPFromLevel(70);
      await itemNFT.addItems([
        {
          ...EstforTypes.defaultItemInput,
          tokenId: EstforConstants.MAGIC_FIRE_STARTER,
          equipPosition: EstforTypes.EquipPosition.RIGHT_HAND,
        },
        {
          ...EstforTypes.defaultItemInput,
          tokenId: EstforConstants.LOG,
          equipPosition: EstforTypes.EquipPosition.AUX,
        },
        {
          ...EstforTypes.defaultItemInput,
          skill: EstforTypes.Skill.HEALTH,
          minXP,
          healthRestored: 12,
          tokenId: EstforConstants.COOKED_MINNUS,
          equipPosition: EstforTypes.EquipPosition.FOOD,
        },
      ]);

      await itemNFT.testMint(alice.address, EstforConstants.LOG, 5);
      await itemNFT.testMint(alice.address, EstforConstants.COOKED_MINNUS, 1);

      await expect(
        players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE)
      ).to.be.revertedWithCustomError(players, "ConsumableMinimumXPNotReached");

      await players.testModifyXP(alice.address, playerId, EstforTypes.Skill.HEALTH, minXP, false);

      // Update health level, check it works
      expect(await players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE)).to
        .not.be.reverted;

      await players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE);
    });

    it("Attire", async function () {
      const {playerId, players, playerNFT, itemNFT, world, alice} = await loadFixture(playersFixture);
      const {queuedAction} = await setupBasicWoodcutting(itemNFT, world);
      const minXP = getXPFromLevel(70);

      await itemNFT.testMints(
        alice.address,
        [
          EstforConstants.BRONZE_AXE,
          EstforConstants.AMETHYST_AMULET,
          EstforConstants.BRONZE_ARMOR,
          EstforConstants.BRONZE_BOOTS,
          EstforConstants.BRONZE_GAUNTLETS,
          EstforConstants.BRONZE_HELMET,
          EstforConstants.BRONZE_TASSETS,
        ],
        [1, 1, 1, 1, 1, 1, 1]
      );

      const attireEquipped = [
        {
          ...EstforTypes.defaultItemInput,
          skill: EstforTypes.Skill.DEFENCE,
          minXP,
          tokenId: EstforConstants.BRONZE_HELMET,
          equipPosition: EstforTypes.EquipPosition.HEAD,
        },
        {
          ...EstforTypes.defaultItemInput,
          skill: EstforTypes.Skill.MELEE,
          minXP,
          tokenId: EstforConstants.AMETHYST_AMULET,
          equipPosition: EstforTypes.EquipPosition.NECK,
        },
        {
          ...EstforTypes.defaultItemInput,
          skill: EstforTypes.Skill.FIREMAKING,
          minXP,
          tokenId: EstforConstants.BRONZE_ARMOR,
          equipPosition: EstforTypes.EquipPosition.BODY,
        },
        {
          ...EstforTypes.defaultItemInput,
          skill: EstforTypes.Skill.MAGIC,
          minXP,
          tokenId: EstforConstants.BRONZE_GAUNTLETS,
          equipPosition: EstforTypes.EquipPosition.ARMS,
        },
        {
          ...EstforTypes.defaultItemInput,
          skill: EstforTypes.Skill.COOKING,
          minXP,
          tokenId: EstforConstants.BRONZE_TASSETS,
          equipPosition: EstforTypes.EquipPosition.LEGS,
        },
        {
          ...EstforTypes.defaultItemInput,
          skill: EstforTypes.Skill.CRAFTING,
          minXP,
          tokenId: EstforConstants.BRONZE_BOOTS,
          equipPosition: EstforTypes.EquipPosition.FEET,
        },
      ];

      await itemNFT.addItems(attireEquipped);

      const equips = ["head", "neck", "body", "arms", "legs", "feet"];
      for (let i = 0; i < attireEquipped.length; ++i) {
        const attire: Attire = {...EstforTypes.noAttire};
        attire[equips[i] as keyof Attire] = attireEquipped[i].tokenId;
        queuedAction.attire = attire;
        await expect(
          players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE)
        ).to.be.revertedWithCustomError(players, "AttireMinimumXPNotReached");
        await players.testModifyXP(alice.address, playerId, attireEquipped[i].skill, minXP, true);
        expect(await players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE))
          .to.not.be.reverted;
      }

      // Test case, create a player
      const makeActive = true;
      await expect(playerNFT.connect(alice).mint(1, "0xSamWitch123", makeActive)).to.not.be.reverted;
    });

    it("Left/Right equipment", async function () {
      const {playerId, players, itemNFT, world, alice} = await loadFixture(playersFixture);
      const rate = 100 * GUAR_MUL; // per hour
      const tx = await world.addActions([
        {
          actionId: 1,
          info: {
            ...defaultActionInfo,
            skill: EstforTypes.Skill.WOODCUTTING,
            xpPerHour: 3600,
            minXP: 0,
            isDynamic: false,
            numSpawned: 0,
            handItemTokenIdRangeMin: EstforConstants.ORICHALCUM_AXE,
            handItemTokenIdRangeMax: EstforConstants.WOODCUTTING_MAX,
            isAvailable: true,
            actionChoiceRequired: false,
            successPercent: 100,
          },
          guaranteedRewards: [{itemTokenId: EstforConstants.LOG, rate}],
          randomRewards: [],
          combatStats: EstforTypes.emptyCombatStats,
        },
      ]);
      const actionId = await getActionId(tx);

      const timespan = 3600;
      const queuedAction: EstforTypes.QueuedActionInput = {
        attire: EstforTypes.noAttire,
        actionId,
        combatStyle: EstforTypes.CombatStyle.NONE,
        choiceId: EstforConstants.NONE,
        regenerateId: EstforConstants.NONE,
        timespan,
        rightHandEquipmentTokenId: EstforConstants.ORICHALCUM_AXE,
        leftHandEquipmentTokenId: EstforConstants.NONE,
      };

      const minXP = getXPFromLevel(70);
      await itemNFT.addItems([
        {
          ...EstforTypes.defaultItemInput,
          skill: EstforTypes.Skill.WOODCUTTING,
          minXP,
          tokenId: EstforConstants.ORICHALCUM_AXE,
          equipPosition: EstforTypes.EquipPosition.RIGHT_HAND,
        },
      ]);

      await itemNFT.testMint(alice.address, EstforConstants.ORICHALCUM_AXE, 1);

      await expect(
        players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE)
      ).to.be.revertedWithCustomError(players, "ItemMinimumXPNotReached");

      // Update to level 70, check it works
      await players.testModifyXP(alice.address, playerId, EstforTypes.Skill.WOODCUTTING, minXP, false);
      expect(await players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE)).to
        .not.be.reverted;
    });

    describe("Missing required equipment right hand equipment", async function () {
      async function expectRemovedCurrentAction(players: Players, playerId: BigNumber, now: number) {
        const player = await players.players(playerId);
        expect(player.currentActionStartTime).to.eq(now);
        expect(player.currentActionProcessedSkill1).to.eq(Skill.NONE);
        expect(player.currentActionProcessedXPGained1).to.eq(0);
        expect(player.currentActionProcessedSkill2).to.eq(Skill.NONE);
        expect(player.currentActionProcessedXPGained2).to.eq(0);
        expect(player.currentActionProcessedSkill3).to.eq(Skill.NONE);
        expect(player.currentActionProcessedXPGained3).to.eq(0);
        expect(player.currentActionProcessedFoodConsumed).to.eq(0);
        expect(player.currentActionProcessedBaseInputItemsConsumedNum).to.eq(0);
      }

      it("Progress first action, then no item, haven't started other actions", async function () {
        const {playerId, players, itemNFT, world, alice, owner} = await loadFixture(playersFixture);

        const {queuedAction} = await setupBasicWoodcutting(itemNFT, world);
        await players
          .connect(alice)
          .startActions(playerId, [queuedAction, queuedAction, queuedAction], EstforTypes.ActionQueueStatus.NONE);
        await ethers.provider.send("evm_increaseTime", [36]);
        await players.connect(alice).processActions(playerId);
        // Remove required item
        await itemNFT
          .connect(alice)
          .safeTransferFrom(alice.address, owner.address, EstforConstants.BRONZE_AXE, 1, "0x");
        // Almost finish
        await ethers.provider.send("evm_increaseTime", [queuedAction.timespan - 200]);
        await ethers.provider.send("evm_mine", []);
        const {timestamp: NOW} = await ethers.provider.getBlock("latest");
        await players.connect(alice).processActions(playerId);
        // First action should be removed
        let actionQueue = await players.getActionQueue(playerId);
        expect(actionQueue.length).to.eq(2);
        expect(actionQueue[0].queueId).to.eq(2);
        expect(actionQueue[1].queueId).to.eq(3);
        await expectRemovedCurrentAction(players, playerId, NOW + 1);
        expect(await players.xp(playerId, EstforTypes.Skill.WOODCUTTING)).to.eq(36);
        expect(await players.xp(playerId, EstforTypes.Skill.FIREMAKING)).to.eq(0);
        expect(await players.xp(playerId, EstforTypes.Skill.FISHING)).to.eq(0);
      });

      it("Finish first action, then no item, haven't started other actions", async function () {
        const {playerId, players, itemNFT, world, alice, owner} = await loadFixture(playersFixture);

        const {queuedAction} = await setupBasicWoodcutting(itemNFT, world);
        const {queuedAction: queuedActionFiremaking} = await setupBasicFiremaking(itemNFT, world);
        const {queuedAction: queuedActionFishing} = await setupBasicFishing(itemNFT, world);
        await players
          .connect(alice)
          .startActions(
            playerId,
            [queuedActionFiremaking, queuedAction, queuedActionFishing],
            EstforTypes.ActionQueueStatus.NONE
          );
        await players.connect(alice).processActions(playerId);

        // Completely finish first one
        await ethers.provider.send("evm_increaseTime", [queuedActionFiremaking.timespan]);
        await players.connect(alice).processActions(playerId);
        // Remove required item
        await itemNFT
          .connect(alice)
          .safeTransferFrom(alice.address, owner.address, EstforConstants.BRONZE_AXE, 1, "0x");
        const {timestamp: NOW} = await ethers.provider.getBlock("latest");
        await players.connect(alice).processActions(playerId);
        // Should remove that action
        let actionQueue = await players.getActionQueue(playerId);
        expect(actionQueue.length).to.eq(1);
        expect(actionQueue[0].queueId).to.eq(3);
        await expectRemovedCurrentAction(players, playerId, NOW + 1);
        expect(await players.xp(playerId, EstforTypes.Skill.FIREMAKING)).to.eq(queuedActionFiremaking.timespan);
        expect(await players.xp(playerId, EstforTypes.Skill.WOODCUTTING)).to.eq(0);
        expect(await players.xp(playerId, EstforTypes.Skill.FISHING)).to.eq(0);
      });

      it("Finish first action, then no items for the other 2", async function () {
        const {playerId, players, itemNFT, world, alice, owner} = await loadFixture(playersFixture);

        const {queuedAction} = await setupBasicWoodcutting(itemNFT, world);
        const {queuedAction: queuedActionFiremaking} = await setupBasicFiremaking(itemNFT, world);
        const {queuedAction: queuedActionFishing} = await setupBasicFishing(itemNFT, world);
        await players
          .connect(alice)
          .startActions(
            playerId,
            [queuedActionFiremaking, queuedAction, queuedActionFishing],
            EstforTypes.ActionQueueStatus.NONE
          );
        await players.connect(alice).processActions(playerId);

        // Completely finish first one and go into the second one a bit
        await ethers.provider.send("evm_increaseTime", [queuedActionFiremaking.timespan + 1]);
        await players.connect(alice).processActions(playerId);
        // Remove required items
        await itemNFT
          .connect(alice)
          .safeTransferFrom(alice.address, owner.address, EstforConstants.BRONZE_AXE, 1, "0x");
        await itemNFT.connect(alice).safeTransferFrom(alice.address, owner.address, EstforConstants.NET_STICK, 1, "0x");
        const {timestamp: NOW} = await ethers.provider.getBlock("latest");
        await players.connect(alice).processActions(playerId);
        // Should remove the second action only, the last one hasn't started yet
        let actionQueue = await players.getActionQueue(playerId);
        expect(actionQueue.length).to.eq(1);
        expect(actionQueue[0].queueId).to.eq(3);
        await expectRemovedCurrentAction(players, playerId, NOW + 1);
        await players.connect(alice).processActions(playerId);
        actionQueue = await players.getActionQueue(playerId);
        expect(actionQueue.length).to.eq(0);
        await expectRemovedCurrentAction(players, playerId, 0);
        expect(await players.xp(playerId, EstforTypes.Skill.FIREMAKING)).to.eq(queuedActionFiremaking.timespan);
        expect(await players.xp(playerId, EstforTypes.Skill.WOODCUTTING)).to.eq(0);
        expect(await players.xp(playerId, EstforTypes.Skill.FISHING)).to.eq(0);
      });

      it("Have no items, partial start the last action", async function () {
        const {playerId, players, itemNFT, world, alice, owner} = await loadFixture(playersFixture);

        const {queuedAction} = await setupBasicWoodcutting(itemNFT, world);
        const {queuedAction: queuedActionFiremaking} = await setupBasicFiremaking(itemNFT, world);
        const {queuedAction: queuedActionFishing} = await setupBasicFishing(itemNFT, world);
        await players
          .connect(alice)
          .startActions(
            playerId,
            [queuedActionFiremaking, queuedAction, queuedActionFishing],
            EstforTypes.ActionQueueStatus.NONE
          );
        await players.connect(alice).processActions(playerId);

        // Completely finish first one and go into the second one a bit
        await ethers.provider.send("evm_increaseTime", [queuedActionFiremaking.timespan + queuedAction.timespan + 1]);
        // Remove required items
        await itemNFT
          .connect(alice)
          .safeTransferFrom(alice.address, owner.address, EstforConstants.MAGIC_FIRE_STARTER, 1, "0x");
        await itemNFT
          .connect(alice)
          .safeTransferFrom(alice.address, owner.address, EstforConstants.BRONZE_AXE, 1, "0x");
        await itemNFT.connect(alice).safeTransferFrom(alice.address, owner.address, EstforConstants.NET_STICK, 1, "0x");
        await players.connect(alice).processActions(playerId);
        // Should remove all actions
        await players.connect(alice).processActions(playerId);
        const actionQueue = await players.getActionQueue(playerId);
        expect(actionQueue.length).to.eq(0);
        await expectRemovedCurrentAction(players, playerId, 0);
        expect(await players.xp(playerId, EstforTypes.Skill.FIREMAKING)).to.eq(0);
        expect(await players.xp(playerId, EstforTypes.Skill.WOODCUTTING)).to.eq(0);
        expect(await players.xp(playerId, EstforTypes.Skill.FISHING)).to.eq(0);
      });
      it("Have no items, finish all actions", async function () {
        const {playerId, players, itemNFT, world, alice, owner} = await loadFixture(playersFixture);

        const {queuedAction} = await setupBasicWoodcutting(itemNFT, world);
        const {queuedAction: queuedActionFiremaking} = await setupBasicFiremaking(itemNFT, world);
        const {queuedAction: queuedActionFishing} = await setupBasicFishing(itemNFT, world);
        await players
          .connect(alice)
          .startActions(
            playerId,
            [queuedActionFiremaking, queuedAction, queuedActionFishing],
            EstforTypes.ActionQueueStatus.NONE
          );
        await players.connect(alice).processActions(playerId);

        // Completely finish first one and go into the second one a bit
        await ethers.provider.send("evm_increaseTime", [
          queuedActionFiremaking.timespan + queuedAction.timespan + queuedActionFishing.timespan,
        ]);
        // Remove required items
        await itemNFT
          .connect(alice)
          .safeTransferFrom(alice.address, owner.address, EstforConstants.MAGIC_FIRE_STARTER, 1, "0x");
        await itemNFT
          .connect(alice)
          .safeTransferFrom(alice.address, owner.address, EstforConstants.BRONZE_AXE, 1, "0x");
        await itemNFT.connect(alice).safeTransferFrom(alice.address, owner.address, EstforConstants.NET_STICK, 1, "0x");
        await players.connect(alice).processActions(playerId);
        // Should remove all actions
        await players.connect(alice).processActions(playerId);
        const actionQueue = await players.getActionQueue(playerId);
        expect(actionQueue.length).to.eq(0);
        await expectRemovedCurrentAction(players, playerId, 0);
        expect(await players.xp(playerId, EstforTypes.Skill.FIREMAKING)).to.eq(0);
        expect(await players.xp(playerId, EstforTypes.Skill.WOODCUTTING)).to.eq(0);
        expect(await players.xp(playerId, EstforTypes.Skill.FISHING)).to.eq(0);
      });
    });

    it("currentAction in-progress actions", async function () {
      const {playerId, players, itemNFT, world, alice, owner} = await loadFixture(playersFixture);
      const {queuedAction, rate} = await setupBasicWoodcutting(itemNFT, world);

      await players
        .connect(alice)
        .startActions(playerId, [queuedAction, queuedAction], EstforTypes.ActionQueueStatus.NONE);

      await ethers.provider.send("evm_increaseTime", [(queuedAction.timespan * 10) / rate]); // Just do 1 of the action
      await ethers.provider.send("evm_mine", []);
      const {timestamp: NOW} = await ethers.provider.getBlock("latest");
      await players.connect(alice).processActions(playerId);
      const player = await players.players(playerId);
      expect(player.currentActionStartTime).to.eq(NOW + 1);
      expect(player.currentActionProcessedSkill1).to.eq(Skill.WOODCUTTING);
      expect(player.currentActionProcessedXPGained1).to.eq((queuedAction.timespan * 10) / rate);
      expect(player.currentActionProcessedSkill2).to.eq(Skill.NONE);
      expect(player.currentActionProcessedXPGained2).to.eq(0);
      expect(player.currentActionProcessedFoodConsumed).to.eq(0);
      expect(player.currentActionProcessedBaseInputItemsConsumedNum).to.eq(0);
    });

    it("Maxing out XP", async function () {
      const {playerId, players, itemNFT, world, alice} = await loadFixture(playersFixture);
      const rate = 100 * GUAR_MUL; // per hour
      const tx = await world.addActions([
        {
          actionId: 1,
          info: {
            ...defaultActionInfo,
            skill: EstforTypes.Skill.WOODCUTTING,
            xpPerHour: 16000000, // 16MM
            minXP: 0,
            isDynamic: false,
            numSpawned: 0,
            handItemTokenIdRangeMin: EstforConstants.ORICHALCUM_AXE,
            handItemTokenIdRangeMax: EstforConstants.WOODCUTTING_MAX,
            isAvailable: true,
            actionChoiceRequired: false,
            successPercent: 100,
          },
          guaranteedRewards: [{itemTokenId: EstforConstants.LOG, rate}],
          randomRewards: [],
          combatStats: EstforTypes.emptyCombatStats,
        },
      ]);
      const actionId = await getActionId(tx);

      const timespan = 3600 * 24;
      const queuedAction: EstforTypes.QueuedActionInput = {
        attire: EstforTypes.noAttire,
        actionId,
        combatStyle: EstforTypes.CombatStyle.NONE,
        choiceId: EstforConstants.NONE,
        regenerateId: EstforConstants.NONE,
        timespan,
        rightHandEquipmentTokenId: EstforConstants.ORICHALCUM_AXE,
        leftHandEquipmentTokenId: EstforConstants.NONE,
      };

      const minXP = getXPFromLevel(98);
      await players.testModifyXP(alice.address, playerId, EstforTypes.Skill.WOODCUTTING, minXP, false);

      await itemNFT.addItems([
        {
          ...EstforTypes.defaultItemInput,
          skill: EstforTypes.Skill.WOODCUTTING,
          minXP,
          tokenId: EstforConstants.ORICHALCUM_AXE,
          equipPosition: EstforTypes.EquipPosition.RIGHT_HAND,
        },
      ]);

      await itemNFT.testMint(alice.address, EstforConstants.ORICHALCUM_AXE, 1);

      // 16MM is the maximum xp per hour that can be gained, so need to loop it many time to go over
      for (let i = 0; i < 25; ++i) {
        await players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE);
        await ethers.provider.send("evm_increaseTime", [24 * 3600]);
        await players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE);
      }
      expect(await players.xp(playerId, EstforTypes.Skill.WOODCUTTING)).to.eq(Math.pow(2, 32) - 1);
    });

    it("Set active player to existing", async function () {
      const {playerId, players, alice} = await loadFixture(playersFixture);
      await expect(players.connect(alice).setActivePlayer(playerId)).to.be.revertedWithCustomError(
        players,
        "PlayerAlreadyActive"
      );
    });

    it("Transferring active player", async function () {
      const {playerId, players, playerNFT, alice, owner} = await loadFixture(playersFixture);

      expect(await players.connect(alice).activePlayer(alice.address)).to.eq(playerId);
      await playerNFT.connect(alice).safeTransferFrom(alice.address, owner.address, playerId, 1, "0x");
      expect(await players.connect(alice).activePlayer(alice.address)).to.eq(0);
    });

    it("Transferring non-active player", async function () {
      const {playerId, players, playerNFT, alice, owner} = await loadFixture(playersFixture);

      const newPlayerId = await createPlayer(playerNFT, 1, alice, "New name", false);
      expect(await players.connect(alice).activePlayer(alice.address)).to.eq(playerId);
      await playerNFT.connect(alice).safeTransferFrom(alice.address, owner.address, newPlayerId, 1, "0x");
      expect(await players.connect(alice).activePlayer(alice.address)).to.eq(playerId);
    });

    it("Game paused", async function () {
      const {playerId, players, itemNFT, world, alice, owner} = await loadFixture(playersFixture);

      // Do not allow processing an action while game is paused
      const {queuedAction} = await setupBasicWoodcutting(itemNFT, world);
      await expect(players.connect(alice).pauseGame(true)).to.be.revertedWithCustomError(players, "CallerIsNotOwner");
      await players.pauseGame(true);
      await expect(
        players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE)
      ).to.be.revertedWithCustomError(players, "GameIsPaused");
      await players.pauseGame(false);
      await players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE);
      await players.pauseGame(true);
      await expect(players.connect(alice).processActions(playerId)).to.be.revertedWithCustomError(
        players,
        "GameIsPaused"
      );
      await players.pauseGame(false);
      await expect(players.connect(alice).processActions(playerId)).to.not.be.reverted;
    });

    it("0 timespan for an action is not allowed", async function () {
      const {playerId, players, itemNFT, world, alice} = await loadFixture(playersFixture);
      const {queuedAction: basicWoodcuttingQueuedAction} = await setupBasicWoodcutting(itemNFT, world);
      const queuedAction = {...basicWoodcuttingQueuedAction};
      queuedAction.timespan = 0;
      await expect(
        players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE)
      ).to.be.revertedWithCustomError(players, "EmptyTimespan");
    });

    it("Should error when specifying choice id when it isn't required", async function () {
      const {playerId, players, itemNFT, world, alice} = await loadFixture(playersFixture);
      const {queuedAction: basicWoodcuttingQueuedAction} = await setupBasicWoodcutting(itemNFT, world);
      const queuedAction = {...basicWoodcuttingQueuedAction};
      queuedAction.choiceId = EstforConstants.ACTIONCHOICE_COOKING_ANCHO;
      await expect(
        players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE)
      ).to.be.revertedWithCustomError(players, "ActionChoiceIdNotRequired");
    });

    it("Check timespan overflow", async function () {
      // This test was added to check for a bug where the timespan was > 65535 but cast to uint16
      const {playerId, players, itemNFT, world, alice} = await loadFixture(playersFixture);

      const {queuedAction: basicWoodcuttingQueuedAction} = await setupBasicWoodcutting(itemNFT, world);
      const queuedAction = {...basicWoodcuttingQueuedAction};
      queuedAction.timespan = 24 * 3600;
      await players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE);
      await ethers.provider.send("evm_increaseTime", [5]);
      await players.connect(alice).processActions(playerId);
      const actionQueue = await players.getActionQueue(playerId);
      expect(actionQueue[0].timespan).gt(queuedAction.timespan - 10);
    });

    it("Base XP boost", async function () {
      const {players, playerNFT, itemNFT, world, alice} = await loadFixture(playersFixture);

      const avatarId = 2;
      const avatarInfo: AvatarInfo = {
        name: "Name goes here",
        description: "Hi I'm a description",
        imageURI: "1234.png",
        startSkills: [Skill.WOODCUTTING, Skill.NONE],
      };
      await playerNFT.setAvatars(avatarId, [avatarInfo]);
      const playerId = await createPlayer(playerNFT, avatarId, alice, "New name", true);

      const {queuedAction} = await setupBasicWoodcutting(itemNFT, world);
      await players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE);
      await ethers.provider.send("evm_increaseTime", [queuedAction.timespan]);
      await ethers.provider.send("evm_mine", []);

      const pendingQueuedActionState = await players.pendingQueuedActionState(alice.address, playerId);
      expect(pendingQueuedActionState.actionMetadatas[0].xpGained).to.eq(Math.floor(queuedAction.timespan * 1.1));
      await players.connect(alice).processActions(playerId);
      const startXP = START_XP;
      expect(await players.xp(playerId, EstforTypes.Skill.WOODCUTTING)).to.eq(
        Math.floor(startXP + queuedAction.timespan * 1.1)
      );
    });

    it("Base XP boost, 2 skills", async function () {
      const {players, playerNFT, itemNFT, world, alice} = await loadFixture(playersFixture);

      const avatarId = 2;
      const avatarInfo: AvatarInfo = {
        name: "Name goes here",
        description: "Hi I'm a description",
        imageURI: "1234.png",
        startSkills: [Skill.THIEVING, Skill.WOODCUTTING],
      };
      await playerNFT.setAvatars(avatarId, [avatarInfo]);
      const playerId = await createPlayer(playerNFT, avatarId, alice, "New name", true);

      const {queuedAction} = await setupBasicWoodcutting(itemNFT, world);
      await players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE);
      await ethers.provider.send("evm_increaseTime", [queuedAction.timespan]);
      await ethers.provider.send("evm_mine", []);

      const pendingQueuedActionState = await players.pendingQueuedActionState(alice.address, playerId);
      expect(pendingQueuedActionState.actionMetadatas[0].xpGained).to.eq(Math.floor(queuedAction.timespan * 1.05));
      await players.connect(alice).processActions(playerId);
      const startXP = START_XP / 2;
      expect(await players.xp(playerId, EstforTypes.Skill.WOODCUTTING)).to.eq(
        Math.floor(startXP + queuedAction.timespan * 1.05)
      );
    });

    it("Revert if trying to initialize QueueActionImpl", async function () {
      const {playersImplMisc1} = await loadFixture(playersFixture);

      await expect(
        playersImplMisc1.initialize(
          ethers.constants.AddressZero,
          ethers.constants.AddressZero,
          ethers.constants.AddressZero,
          ethers.constants.AddressZero,
          ethers.constants.AddressZero,
          ethers.constants.AddressZero,
          ethers.constants.AddressZero,
          ethers.constants.AddressZero,
          ethers.constants.AddressZero,
          ethers.constants.AddressZero,
          ethers.constants.AddressZero,
          false
        )
      ).to.be.revertedWithCustomError(playersImplMisc1, "CannotCallInitializerOnImplementation");
    });

    it("testModifyXP should revert if there are actions queued", async function () {
      const {players, playerId, itemNFT, world, alice} = await loadFixture(playersFixture);
      const {queuedAction} = await setupBasicWoodcutting(itemNFT, world);
      await players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE);
      await expect(
        players.testModifyXP(alice.address, playerId, EstforTypes.Skill.WOODCUTTING, 100, false)
      ).to.be.revertedWithCustomError(players, "HasQueuedActions");
    });

    it("Travelling", async function () {
      const {players, playerId, itemNFT, world, alice} = await loadFixture(playersFixture);
      const {queuedAction} = await setupTravelling(world, 0.125 * RATE_MUL, 0, 1);

      const queuedActionInvalidTimespan = {...queuedAction, timespan: 1800};
      await expect(
        players.connect(alice).startActions(playerId, [queuedActionInvalidTimespan], EstforTypes.ActionQueueStatus.NONE)
      ).to.be.revertedWithCustomError(players, "InvalidTravellingTimespan");

      // Travel from 0 to 1
      await players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE);
      await ethers.provider.send("evm_increaseTime", [queuedAction.timespan]);
      await ethers.provider.send("evm_mine", []);
      const pendingQueuedActionState = await players.pendingQueuedActionState(alice.address, playerId);
      expect(pendingQueuedActionState.worldLocation).to.eq(1);
      await players.connect(alice).processActions(playerId);
      expect((await players.players(playerId)).packedData).to.eq("0x01");
      // Should earn agility xp
      expect(await players.xp(playerId, EstforTypes.Skill.AGILITY)).to.eq(queuedAction.timespan);

      // Trying to travel from 0 to 1 should do nothing and earn no xp. Should be allowed to queue but it does nothing
      await players.connect(alice).startActions(playerId, [queuedAction], EstforTypes.ActionQueueStatus.NONE);
      await ethers.provider.send("evm_increaseTime", [queuedAction.timespan]);
      expect(await players.xp(playerId, EstforTypes.Skill.AGILITY)).to.eq(queuedAction.timespan);

      // Can process an action that is intended for area 1 only
      const {queuedAction: queuedActionWoodcutting} = await setupBasicWoodcutting(itemNFT, world);

      // Confirm a starting area skill cannot be used in a different area
      await players
        .connect(alice)
        .startActions(playerId, [queuedActionWoodcutting], EstforTypes.ActionQueueStatus.NONE);
      await ethers.provider.send("evm_increaseTime", [queuedActionWoodcutting.timespan]);
      await players.connect(alice).processActions(playerId);
      expect(await players.xp(playerId, EstforTypes.Skill.WOODCUTTING)).to.eq(0);
    });
  });
});
