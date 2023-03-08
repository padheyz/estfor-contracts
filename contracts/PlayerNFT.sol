// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/Multicall.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";

import "./interfaces/IBrushToken.sol";
import "./interfaces/IPlayers.sol";
import "./types.sol";
import "./items.sol";

// Each NFT represents a player. This contract deals with the NFTs, and the Players contract deals with the player data
contract PlayerNFT is ERC1155Upgradeable, UUPSUpgradeable, OwnableUpgradeable, IERC2981, Multicall {
  event NewPlayer(uint playerId, uint avatarId, bytes20 name);
  event EditPlayer(uint playerId, bytes20 newName);

  event SetAvatar(uint avatarId, AvatarInfo avatarInfo);
  event SetAvatars(uint startAvatarId, AvatarInfo[] avatarInfos);

  struct AvatarInfo {
    bytes32 name;
    string description;
    string imageURI;
  }

  error NotOwner();
  error AvatarNotExists();

  uint public latestPlayerId;

  mapping(uint => AvatarInfo) public avatars;
  string public baseURI;
  mapping(uint => uint) public playerIdToAvatar; // playerId => avatar id
  mapping(uint => bytes32) public names;
  mapping(bytes => bool) public lowercaseNames; // name => exists

  IBrushToken public brush;
  IPlayers public players;
  address public pool;

  uint public editNameCost;
  uint public royaltyFee;
  address public royaltyReceiver;

  bytes32 merkleRoot; // For airdrop
  mapping(address => bool) hasMintedFromWhitelist;

  modifier isOwnerOfPlayer(uint playerId) {
    if (balanceOf(msg.sender, playerId) != 1) {
      revert NotOwner();
    }
    _;
  }

  modifier onlyPlayers() {
    require(msg.sender == address(players), "Not players");
    _;
  }

  /// @custom:oz-upgrades-unsafe-allow constructor
  constructor() {
    _disableInitializers();
  }

  function initialize(
    IBrushToken _brush,
    address _pool,
    address _royaltyReceiver,
    uint _editNameCost
  ) public initializer {
    __ERC1155_init("");
    __Ownable_init();
    __UUPSUpgradeable_init();
    brush = _brush;
    latestPlayerId = 1;
    baseURI = "ipfs://";
    pool = _pool;
    editNameCost = _editNameCost;
    royaltyFee = 250; // 2.5%
    royaltyReceiver = _royaltyReceiver;
  }

  function _mintStartingItems() private {
    // Give the player some starting items
    uint[] memory itemNFTs = new uint[](5);
    itemNFTs[0] = BRONZE_SWORD;
    itemNFTs[1] = BRONZE_AXE;
    itemNFTs[2] = FIRE_LIGHTER;
    itemNFTs[3] = SMALL_NET;
    itemNFTs[4] = BRONZE_PICKAXE;

    uint[] memory quantities = new uint[](5);
    quantities[0] = 1;
    quantities[1] = 1;
    quantities[2] = 1;
    quantities[3] = 1;
    quantities[4] = 1;
    players.mintBatch(msg.sender, itemNFTs, quantities);
  }

  function _setName(uint _playerId, bytes20 _name) private {
    require(uint160(_name) != 0, "Name cannot be empty");
    names[_playerId] = _name;
    bytes memory lowercaseName = _toLower(_name);
    require(!lowercaseNames[lowercaseName], "Name already exists");
    lowercaseNames[lowercaseName] = true;
  }

  // Minting whitelist for the alpha
  function setMerkleRoot(bytes32 _merkleRoot) external onlyOwner {
    merkleRoot = _merkleRoot;
  }

  function checkInWhitelist(bytes32[] calldata proof) public view returns (bool) {
    bytes32 leaf = keccak256(abi.encodePacked(msg.sender));
    return MerkleProof.verify(proof, merkleRoot, leaf);
  }

  function mintWhitelist(uint _avatarId, bytes32 _name, bool _makeActive, bytes32[] calldata _proof) external {
    require(checkInWhitelist(_proof), "Not in whitelist");
    require(!hasMintedFromWhitelist[msg.sender], "Already minted");
    hasMintedFromWhitelist[msg.sender] = true;
    mint(_avatarId, _name, _makeActive);
  }

  // Costs nothing to mint, only gas
  function mint(uint _avatarId, bytes32 _name, bool _makeActive) public {
    address from = msg.sender;
    uint playerId = latestPlayerId++;
    emit NewPlayer(playerId, _avatarId, bytes20(_name));
    _mint(from, playerId, 1, "");
    _setName(playerId, bytes20(_name));
    players.mintedPlayer(from, playerId, _makeActive);
    _mintStartingItems();
    _setTokenIdToAvatar(playerId, _avatarId);
  }

  function _setTokenIdToAvatar(uint _playerId, uint _avatarId) private {
    if (bytes(avatars[_avatarId].description).length == 0) {
      revert AvatarNotExists();
    }
    playerIdToAvatar[_playerId] = _avatarId;
  }

  function uri(uint256 _playerId) public view virtual override returns (string memory) {
    require(_exists(_playerId), "ERC1155Metadata: URI query for nonexistent token");
    AvatarInfo storage avatarInfo = avatars[playerIdToAvatar[_playerId]];
    string memory imageURI = string(abi.encodePacked(baseURI, avatarInfo.imageURI));
    return players.getURI(_playerId, names[_playerId], avatarInfo.name, avatarInfo.description, imageURI);
  }

  function _beforeTokenTransfer(
    address /*operator*/,
    address from,
    address to,
    uint256[] memory ids,
    uint256[] memory amounts,
    bytes memory /*data*/
  ) internal virtual override {
    if (from == address(0) || amounts.length == 0 || from == to) {
      return;
    }
    uint i = 0;
    do {
      // Get player and consume any actions & unequip all items before transferring the whole player
      uint playerId = ids[i];
      players.clearEverythingBeforeTokenTransfer(from, playerId);
      unchecked {
        ++i;
      }
    } while (i < ids.length);
  }

  /**
   * @dev Returns whether `playerId` exists.
   *
   * Tokens can be managed by their owner or approved accounts via {approve} or {setApprovalForAll}.
   *
   */
  function _exists(uint256 _playerId) private view returns (bool) {
    return playerIdToAvatar[_playerId] != 0;
  }

  function editName(uint _playerId, bytes32 _newName) external isOwnerOfPlayer(_playerId) {
    uint brushCost = editNameCost;
    // Pay
    brush.transferFrom(msg.sender, address(this), brushCost);
    // Send half to the pool (currently shop)
    brush.transferFrom(msg.sender, pool, brushCost - (brushCost / 2));
    // Burn the other half
    brush.burn(brushCost / 2);

    // Delete old name
    bytes32 oldName = names[_playerId];
    delete names[_playerId];
    bytes memory oldLowercaseName = _toLower(oldName);
    delete lowercaseNames[oldLowercaseName];

    _setName(_playerId, bytes20(_newName));

    emit EditPlayer(_playerId, bytes20(_newName));
  }

  /**
   * @dev See {IERC1155-balanceOfBatch}. This implementation is not standard ERC1155, it's optimized for the single account case
   */
  function balanceOfs(address _account, uint16[] memory _ids) external view returns (uint256[] memory batchBalances) {
    batchBalances = new uint256[](_ids.length);

    for (uint16 i = 0; i < _ids.length; ++i) {
      batchBalances[i] = balanceOf(_account, _ids[i]);
    }
  }

  function _toLower(bytes32 _name) private pure returns (bytes memory) {
    bytes memory lowerName = bytes(abi.encodePacked(_name));
    for (uint i = 0; i < lowerName.length; i++) {
      if ((uint8(lowerName[i]) >= 65) && (uint8(lowerName[i]) <= 90)) {
        // So we add 32 to make it lowercase
        lowerName[i] = bytes1(uint8(lowerName[i]) + 32);
      }
    }
    return lowerName;
  }

  function burn(address _from, uint _playerId) external {
    require(
      _from == _msgSender() || isApprovedForAll(_from, _msgSender()),
      "ERC1155: caller is not token owner or approved"
    );
    _burn(_from, _playerId, 1);
  }

  function royaltyInfo(
    uint256 _tokenId,
    uint256 _salePrice
  ) external view override returns (address receiver, uint256 royaltyAmount) {
    uint256 amount = (_salePrice * royaltyFee) / 10000;
    return (royaltyReceiver, amount);
  }

  function supportsInterface(bytes4 interfaceId) public view override(IERC165, ERC1155Upgradeable) returns (bool) {
    return interfaceId == type(IERC2981).interfaceId || super.supportsInterface(interfaceId);
  }

  function setRoyaltyReceiver(address _receiver) external onlyOwner {
    royaltyReceiver = _receiver;
  }

  function setAvatar(uint _avatarId, AvatarInfo calldata _avatarInfo) external onlyOwner {
    avatars[_avatarId] = _avatarInfo;
    emit SetAvatar(_avatarId, _avatarInfo);
  }

  function setAvatars(uint _startAvatarId, AvatarInfo[] calldata _avatarInfos) external onlyOwner {
    for (uint i; i < _avatarInfos.length; ++i) {
      avatars[_startAvatarId + i] = _avatarInfos[i];
    }
    emit SetAvatars(_startAvatarId, _avatarInfos);
  }

  function setBaseURI(string calldata _baseURI) external onlyOwner {
    _setURI(_baseURI);
  }

  function setPlayers(IPlayers _players) external onlyOwner {
    players = _players;
  }

  function setEditNameCost(uint _editNameCost) external onlyOwner {
    editNameCost = _editNameCost;
  }

  function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
