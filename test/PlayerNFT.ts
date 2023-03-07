import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {expect} from "chai";
import {ethers, upgrades} from "hardhat";
import {createPlayer} from "../scripts/utils";
import { PlayerNFT } from "../typechain-types";

describe("PlayerNFT", () => {
  async function deployContracts() {
    const [owner, alice] = await ethers.getSigners();

    const MockBrushToken = await ethers.getContractFactory("MockBrushToken");
    const brush = await MockBrushToken.deploy();

    const MockOracleClient = await ethers.getContractFactory("MockOracleClient");
    const mockOracleClient = await MockOracleClient.deploy();

    // Create the world
    const subscriptionId = 2;
    const World = await ethers.getContractFactory("World");
    const world = await upgrades.deployProxy(World, [mockOracleClient.address, subscriptionId], {
      kind: "uups",
    });

    const Shop = await ethers.getContractFactory("Shop");
    const shop = await upgrades.deployProxy(Shop, [brush.address], {
      kind: "uups",
      unsafeAllow: ["delegatecall"],
    });

    // Create NFT contract which contains all items
    const ItemNFT = await ethers.getContractFactory("ItemNFT");
    const itemNFT = await upgrades.deployProxy(ItemNFT, [world.address, shop.address], {
      kind: "uups",
      unsafeAllow: ["delegatecall"],
    });

    await shop.setItemNFT(itemNFT.address);
    // Create NFT contract which contains all the players
    const PlayerNFT = await ethers.getContractFactory("PlayerNFT");
    const playerNFT = (await upgrades.deployProxy(PlayerNFT, [brush.address, shop.address, 5000], {kind: "uups"})) as PlayerNFT;

    // This contains all the player data
    const PlayerLibrary = await ethers.getContractFactory("PlayerLibrary");
    const playerLibrary = await PlayerLibrary.deploy();

    const PlayersImplQueueActions = await ethers.getContractFactory("PlayersImplQueueActions");
    const playersImplQueueActions = await PlayersImplQueueActions.deploy();

    const PlayersImplProcessActions = await ethers.getContractFactory("PlayersImplProcessActions", {
      libraries: {PlayerLibrary: playerLibrary.address},
    });
    const playersImplProcessActions = await PlayersImplProcessActions.deploy();

    const PlayersImplRewards = await ethers.getContractFactory("PlayersImplRewards", {
      libraries: {PlayerLibrary: playerLibrary.address},
    });
    const playersImplRewards = await PlayersImplRewards.deploy();

    const Players = await ethers.getContractFactory("Players", {
      libraries: {PlayerLibrary: playerLibrary.address},
    });

    const players = await upgrades.deployProxy(
      Players,
      [
        itemNFT.address,
        playerNFT.address,
        world.address,
        playersImplQueueActions.address,
        playersImplProcessActions.address,
        playersImplRewards.address,
      ],
      {
        kind: "uups",
        unsafeAllow: ["delegatecall", "external-library-linking"],
      }
    );

    await itemNFT.setPlayers(players.address);
    await playerNFT.setPlayers(players.address);

    const avatarId = 1;
    const avatarInfo = {
      name: ethers.utils.formatBytes32String("Name goes here"),
      description: "Hi I'm a description",
      imageURI: "1234.png",
    };
    await playerNFT.setAvatar(avatarId, avatarInfo);

    // Create player
    const origName = "0xSamWitch";
    const makeActive = true;
    const playerId = await createPlayer(
      playerNFT,
      avatarId,
      alice,
      ethers.utils.formatBytes32String(origName),
      makeActive
    );
    await players.connect(alice).setActivePlayer(playerId);
    const maxTime = await players.MAX_TIME();
    const editNameCost = await playerNFT.editNameCost();

    return {
      playerId,
      players,
      playerNFT,
      itemNFT,
      brush,
      maxTime,
      owner,
      world,
      alice,
      origName,
      editNameCost,
      mockOracleClient,
      avatarInfo,
    };
  }

  it("Empty name", async () => {
    const {playerNFT, alice} = await loadFixture(deployContracts);
    const nameTooLong = ethers.utils.formatBytes32String("");
    const avatarId = 1;
    await expect(createPlayer(playerNFT, avatarId, alice, nameTooLong, true)).to.be.reverted;
  });

  it("Name too long", async () => {
    const {playerNFT, alice} = await loadFixture(deployContracts);
    const nameTooLong = ethers.utils.formatBytes32String("F12345678901234567890");
    const avatarId = 1;
    const makeActive = true;
    const newPlayerId = await createPlayer(playerNFT, avatarId, alice, nameTooLong, makeActive);

    expect(await playerNFT.names(newPlayerId)).to.eq(ethers.utils.formatBytes32String("F1234567890123456789"));
    expect(await playerNFT.lowercaseNames(ethers.utils.formatBytes32String("f1234567890123456789"))).to.be.true;
  });

  it("Duplicate names not allowed", async () => {
    const {playerNFT, alice} = await loadFixture(deployContracts);

    const name = ethers.utils.formatBytes32String("123");
    const avatarId = 1;
    const makeActive = true;
    await createPlayer(playerNFT, avatarId, alice, name, makeActive);
    await expect(createPlayer(playerNFT, avatarId, alice, name, true)).to.be.reverted;
  });

  it("Edit Name", async () => {
    const {playerId, playerNFT, alice, brush, origName, editNameCost} = await loadFixture(deployContracts);
    const name = ethers.utils.formatBytes32String("My name is edited");
    await expect(playerNFT.connect(alice).editName(playerId, name)).to.be.reverted; // Haven't got the brush

    await brush.mint(alice.address, editNameCost.mul(2));
    await brush.connect(alice).approve(playerNFT.address, editNameCost.mul(2));

    await expect(playerNFT.editName(playerId, name)).to.be.reverted; // Not the owner
    expect(await playerNFT.connect(alice).lowercaseNames(ethers.utils.formatBytes32String(origName.toLowerCase()))).to
      .be.true;

    await playerNFT.connect(alice).editName(playerId, name);
    expect(await playerNFT.connect(alice).lowercaseNames(ethers.utils.formatBytes32String(origName.toLowerCase()))).to
      .be.false; // Should be deleted now
    expect(await playerNFT.connect(alice).names(playerId)).to.eq(name);

    const avatarId = 1;
    const makeActive = true;
    // Duplicate
    const newPlayerId = await createPlayer(
      playerNFT,
      avatarId,
      alice,
      ethers.utils.formatBytes32String("name"),
      makeActive
    );
    await expect(playerNFT.connect(alice).editName(newPlayerId, name)).to.be.reverted;
  });

  it("uri", async () => {
    const {playerId, playerNFT, avatarInfo} = await loadFixture(deployContracts);
    const uri = await playerNFT.uri(playerId);

    expect(uri.startsWith('data:application/json;base64')).to.be.true;
    const metadata = JSON.parse(Buffer.from(uri.split(';base64,')[1], 'base64').toString());
    expect(metadata).to.have.property('name');
    expect(metadata.name).to.equal('0xSamWitch'); // TODO: give the player a better name than 0xSamWitch
    expect(metadata.image).to.eq(`ipfs://${avatarInfo.imageURI}`);
    expect(metadata).to.have.property('attributes');
    expect(metadata.attributes).to.be.an('array');
    expect(metadata.attributes).to.have.length(13);
    expect(metadata.attributes[0]).to.have.property('trait_type');
    expect(metadata.attributes[0].trait_type).to.equal('Avatar');
    expect(metadata.attributes[0]).to.have.property('value');
    expect(metadata.attributes[0].value).to.equal('Name goes here');
    expect(metadata.attributes[1]).to.have.property('trait_type');
    expect(metadata.attributes[1].trait_type).to.equal('Attack');
    expect(metadata.attributes[1]).to.have.property('value');
    expect(metadata.attributes[1].value).to.equal(1);
  });

  describe("supportsInterface", async () => {
    it('IERC165', async () => {
      const {playerNFT} = await loadFixture(deployContracts);
      expect(await playerNFT.supportsInterface('0x01ffc9a7')).to.equal(true);
    });
  
    it('IERC1155', async () => {
      const { playerNFT } = await loadFixture(deployContracts);
      expect(await playerNFT.supportsInterface('0xd9b67a26')).to.equal(true);
    });
  
    it('IERC1155Metadata', async () => {
      const { playerNFT } = await loadFixture(deployContracts);
      expect(await playerNFT.supportsInterface('0x0e89341c')).to.equal(true);
    });
  });
});
