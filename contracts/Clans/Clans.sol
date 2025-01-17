// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";

import {UUPSUpgradeable} from "../ozUpgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "../ozUpgradeable/access/OwnableUpgradeable.sol";

import {UnsafeMath, U256} from "@0xdoublesharp/unsafe-math/contracts/UnsafeMath.sol";

import {IBrushToken} from "../interfaces/IBrushToken.sol";
import {IPlayers} from "../interfaces/IPlayers.sol";
import {IClans} from "../interfaces/IClans.sol";
import {IBankFactory} from "../interfaces/IBankFactory.sol";
import {EstforLibrary} from "../EstforLibrary.sol";

contract Clans is UUPSUpgradeable, OwnableUpgradeable, IClans {
  using UnsafeMath for U256;
  using UnsafeMath for uint16;
  using UnsafeMath for uint80;
  using UnsafeMath for uint256;

  event ClanCreated(uint clanId, uint playerId, string[] clanInfo, uint imageId, uint tierId);
  event SetClanRank(uint clanId, uint playerId, ClanRank clan);
  event InviteSent(uint clanId, uint playerId, uint fromPlayerId);
  event InvitesSent(uint clanId, uint[] playerIds, uint fromPlayerId);
  event InviteAccepted(uint clanId, uint playerId);
  event MemberLeft(uint clanId, uint playerId);
  event JoinRequestSent(uint clanId, uint playerId);
  event JoinRequestAccepted(uint clanId, uint playerId, uint acceptedByPlayerId);
  event JoinRequestsAccepted(uint clanId, uint[] playerIds, uint acceptedByPlayerId);
  event JoinRequestRemoved(uint clanId, uint playerId);
  event ClanOwnershipTransferred(uint clanId, uint playerId);
  event AddTiers(Tier[] tiers);
  event EditTiers(Tier[] tiers);
  event ClanOwnerLeft(uint clanId, uint playerId);
  event ClanEdited(uint clanId, uint playerId, string[] clanInfo, uint imageId);
  event ClanUpgraded(uint clanId, uint playerId, uint tierId);
  event ClanDestroyed(uint clanId);
  event PlayerRankUpdated(uint clanId, uint memberId, ClanRank rank, uint playerId);
  event InvitesDeletedByPlayer(uint[] clanIds, uint playerId);
  event InvitesDeletedByClan(uint clanId, uint[] invitedPlayerIds, uint deletedInvitesPlayerId);
  event EditNameCost(uint newCost);

  error AlreadyInClan();
  error NotOwnerOfPlayer();
  error NotOwnerOfPlayerAndActive();
  error NotMemberOfClan();
  error ClanIsFull();
  error OwnerExists();
  error InvalidImageId();
  error NameTooShort();
  error NameTooLong();
  error NameInvalidCharacters();
  error DiscordTooLong();
  error DiscordTooShort();
  error DiscordInvalidCharacters();
  error TelegramTooLong();
  error TelegramInvalidCharacters();
  error ClanDoesNotExist();
  error TierDoesNotExist();
  error CannotDowngradeTier();
  error TierAlreadyExists();
  error NameAlreadyExists();
  error ClanDestroyFailedHasMembers();
  error PriceTooLow();
  error MemberCapacityTooLow();
  error BankCapacityTooLow();
  error ImageIdTooLow();
  error AlreadySentInvite();
  error AlreadySentJoinRequest();
  error NoJoinRequest();
  error RankMustBeLowerRenounce();
  error RankNotHighEnough();
  error CannotSetSameRank();
  error ChangingRankEqualOrHigherThanSelf();
  error ChangingRankOfPlayerHigherThanSelf();
  error ChangingRankOfPlayerEqualOrHigherThanSelf();
  error CannotRenounceToSelf();
  error InviteDoesNotExist();
  error NoInvitesToDelete();

  enum ClanRank {
    NONE, // Not in a clan
    COMMONER, // Member of the clan
    SCOUT, // Invite and kick commoners
    TREASURER, // Can withdraw from bank
    LEADER // Can edit clan details
  }

  struct Clan {
    uint80 owner;
    uint16 imageId;
    uint16 memberCount;
    uint40 createdTimestamp;
    uint8 tierId;
    string name;
    mapping(uint playerId => bool invited) inviteRequests;
  }

  struct PlayerInfo {
    uint32 clanId; // What clan they are in
    ClanRank rank; // Current clan rank
    uint32 requestedClanId; // What clan they have requested to join
  }

  struct Tier {
    uint8 id;
    uint16 maxMemberCapacity;
    uint16 maxBankCapacity;
    uint24 maxImageId;
    uint40 minimumAge; // How old the clan must be before it can be upgraded to this tier
    uint80 price;
  }

  modifier isOwnerOfPlayer(uint _playerId) {
    if (playerNFT.balanceOf(msg.sender, _playerId) == 0) {
      revert NotOwnerOfPlayer();
    }
    _;
  }

  modifier isOwnerOfPlayerAndActive(uint _playerId) {
    if (!players.isOwnerOfPlayerAndActive(msg.sender, _playerId)) {
      revert NotOwnerOfPlayerAndActive();
    }
    _;
  }

  modifier isMinimumRank(
    uint _clanId,
    uint _playerId,
    ClanRank _rank
  ) {
    PlayerInfo storage player = playerInfo[_playerId];
    if (player.clanId != _clanId) {
      revert NotMemberOfClan();
    } else if (playerInfo[_playerId].rank < _rank) {
      revert RankNotHighEnough();
    }
    _;
  }

  modifier isMemberOfClan(uint _clanId, uint _playerId) {
    if (playerInfo[_playerId].clanId != _clanId) {
      revert NotMemberOfClan();
    }
    _;
  }

  IBrushToken private brush;
  IPlayers private players;
  IBankFactory public bankFactory;
  IERC1155 private playerNFT;
  uint80 public nextClanId;
  address private pool;
  uint80 public editNameCost;
  address private dev;
  mapping(uint clanId => Clan clan) public clans;
  mapping(uint playerId => PlayerInfo) public playerInfo;
  mapping(uint id => Tier tier) public tiers;
  mapping(string name => bool exists) public lowercaseNames;
  mapping(uint clanId => uint40 timestampLeft) public ownerlessClanTimestamps; // timestamp

  /// @custom:oz-upgrades-unsafe-allow constructor
  constructor() {
    _disableInitializers();
  }

  function initialize(
    IBrushToken _brush,
    IERC1155 _playerNFT,
    address _pool,
    address _dev,
    uint80 _editNameCost
  ) external initializer {
    __UUPSUpgradeable_init();
    __Ownable_init();
    brush = _brush;
    playerNFT = _playerNFT;
    pool = _pool;
    dev = _dev;
    nextClanId = 1;
    editNameCost = _editNameCost;
    emit EditNameCost(_editNameCost);
  }

  function _checkTierExists(uint _tierId) private view {
    Tier storage tier = tiers[_tierId];
    if (tier.id == 0) {
      revert TierDoesNotExist();
    }
  }

  function createClan(
    uint _playerId,
    string calldata _name,
    string calldata _discord,
    string calldata _telegram,
    uint16 _imageId,
    uint8 _tierId
  ) external isOwnerOfPlayerAndActive(_playerId) {
    PlayerInfo storage player = playerInfo[_playerId];
    if (isMemberOfAnyClan(_playerId)) {
      revert AlreadyInClan();
    }

    Tier storage tier = tiers[_tierId];
    _checkTierExists(_tierId);
    _checkClanImage(_imageId, tier.maxImageId);

    uint clanId = nextClanId;
    nextClanId = uint80(nextClanId.inc());
    Clan storage clan = clans[clanId];
    clan.owner = uint80(_playerId);
    clan.tierId = 1; // Updated later in _upgradeClan if it's > 1
    clan.imageId = _imageId;
    clan.memberCount = 1;
    clan.createdTimestamp = uint40(block.timestamp);

    player.clanId = uint32(clanId);
    player.rank = ClanRank.LEADER;
    if (player.requestedClanId != 0) {
      removeJoinRequest(clanId, _playerId);
    }

    (string memory trimmedName, ) = _setName(clanId, _name);
    _checkSocials(_discord, _telegram);
    string[] memory clanInfo = _createClanInfo(trimmedName, _discord, _telegram);
    emit ClanCreated(clanId, _playerId, clanInfo, _imageId, _tierId);
    if (_tierId != 1) {
      _upgradeClan(clanId, _playerId, _tierId);
    }

    bankFactory.createBank(msg.sender, clanId);
  }

  function editClan(
    uint _clanId,
    string calldata _name,
    string calldata _discord,
    string calldata _telegram,
    uint _imageId
  ) external isOwnerOfPlayer(clans[_clanId].owner) {
    Clan storage clan = clans[_clanId];
    Tier storage tier = tiers[clan.tierId];
    _checkClanImage(_imageId, tier.maxImageId);
    (string memory trimmedName, bool nameChanged) = _setName(_clanId, _name);
    if (nameChanged) {
      _pay(editNameCost);
    }

    _checkSocials(_discord, _telegram);
    string[] memory clanInfo = _createClanInfo(trimmedName, _discord, _telegram);
    emit ClanEdited(_clanId, clans[_clanId].owner, clanInfo, _imageId);
  }

  function deleteInvitesAsPlayer(uint[] calldata _clanIds, uint _playerId) external isOwnerOfPlayer(_playerId) {
    if (_clanIds.length == 0) {
      revert NoInvitesToDelete();
    }

    for (uint i = 0; i < _clanIds.length; ++i) {
      uint clanId = _clanIds[i];
      if (!clans[clanId].inviteRequests[_playerId]) {
        revert InviteDoesNotExist();
      }
      delete clans[clanId].inviteRequests[_playerId];
    }
    emit InvitesDeletedByPlayer(_clanIds, _playerId);
  }

  function deleteInvitesAsClan(
    uint _clanId,
    uint[] calldata _invitedPlayerIds,
    uint _playerId
  ) external isOwnerOfPlayer(_playerId) isMinimumRank(_clanId, _playerId, ClanRank.SCOUT) {
    Clan storage clan = clans[_clanId];
    if (_invitedPlayerIds.length == 0) {
      revert NoInvitesToDelete();
    }

    for (uint i = 0; i < _invitedPlayerIds.length; ++i) {
      uint invitedPlayerId = _invitedPlayerIds[i];
      if (!clan.inviteRequests[invitedPlayerId]) {
        revert InviteDoesNotExist();
      }
      clan.inviteRequests[invitedPlayerId] = false;
    }

    emit InvitesDeletedByClan(_clanId, _invitedPlayerIds, _playerId);
  }

  function _inviteMember(uint _clanId, uint _member) private {
    Clan storage clan = clans[_clanId];
    if (clan.inviteRequests[_member]) {
      revert AlreadySentInvite();
    }

    clan.inviteRequests[_member] = true;
  }

  function inviteMember(
    uint _clanId,
    uint _member,
    uint _playerId
  ) external isOwnerOfPlayer(_playerId) isMinimumRank(_clanId, _playerId, ClanRank.SCOUT) {
    Clan storage clan = clans[_clanId];
    Tier storage tier = tiers[clan.tierId];
    if (clan.memberCount >= tier.maxMemberCapacity) {
      revert ClanIsFull();
    }

    _inviteMember(_clanId, _member);

    emit InviteSent(_clanId, _member, _playerId);
  }

  function inviteMembers(
    uint _clanId,
    uint[] calldata _memberPlayerIds,
    uint _playerId
  ) external isOwnerOfPlayer(_playerId) isMinimumRank(_clanId, _playerId, ClanRank.SCOUT) {
    Clan storage clan = clans[_clanId];
    Tier storage tier = tiers[clan.tierId];
    if (clan.memberCount + _memberPlayerIds.length > tier.maxMemberCapacity) {
      revert ClanIsFull();
    }

    for (uint i = 0; i < _memberPlayerIds.length; ++i) {
      _inviteMember(_clanId, _memberPlayerIds[i]);
    }
    emit InvitesSent(_clanId, _memberPlayerIds, _playerId);
  }

  function acceptInvite(uint _clanId, uint _playerId) external isOwnerOfPlayerAndActive(_playerId) {
    Clan storage clan = clans[_clanId];
    PlayerInfo storage player = playerInfo[_playerId];

    if (!clan.inviteRequests[_playerId]) {
      revert InviteDoesNotExist();
    }

    Tier storage tier = tiers[clan.tierId];
    if (clan.memberCount >= tier.maxMemberCapacity) {
      revert ClanIsFull();
    }

    clan.inviteRequests[_playerId] = false;
    clan.memberCount = uint16(clan.memberCount.inc());

    player.clanId = uint32(_clanId);
    player.rank = ClanRank.COMMONER;
    player.requestedClanId = 0;

    emit InviteAccepted(_clanId, _playerId);
  }

  function requestToJoin(uint _clanId, uint _playerId) external isOwnerOfPlayerAndActive(_playerId) {
    Clan storage clan = clans[_clanId];
    if (clan.createdTimestamp == 0) {
      revert ClanDoesNotExist();
    }

    PlayerInfo storage player = playerInfo[_playerId];

    if (isMemberOfAnyClan(_playerId)) {
      revert AlreadyInClan();
    }

    uint playerRequestedClanId = player.requestedClanId;
    if (playerRequestedClanId != 0) {
      if (playerRequestedClanId == _clanId) {
        revert AlreadySentJoinRequest();
      }
      emit JoinRequestRemoved(playerRequestedClanId, _playerId);
    }

    player.requestedClanId = uint32(_clanId);

    emit JoinRequestSent(_clanId, _playerId);
  }

  function removeJoinRequest(uint _clanId, uint _playerId) public isOwnerOfPlayer(_playerId) {
    playerInfo[_playerId].requestedClanId = 0;
    emit JoinRequestRemoved(_clanId, _playerId);
  }

  function _acceptJoinRequest(uint _clanId, uint _newMemberPlayedId) private {
    Clan storage clan = clans[_clanId];
    clan.inviteRequests[_newMemberPlayedId] = false;
    clan.memberCount = uint16(clan.memberCount.inc());

    PlayerInfo storage player = playerInfo[_newMemberPlayedId];
    if (player.requestedClanId != _clanId) {
      revert NoJoinRequest();
    }
    player.clanId = uint32(_clanId);
    player.requestedClanId = 0;
    player.rank = ClanRank.COMMONER;
  }

  function acceptJoinRequest(
    uint _clanId,
    uint _newMemberPlayedId,
    uint _playerId
  ) public isOwnerOfPlayerAndActive(_playerId) isMinimumRank(_clanId, _playerId, ClanRank.SCOUT) {
    Clan storage clan = clans[_clanId];
    Tier storage tier = tiers[clan.tierId];
    if (clan.memberCount >= tier.maxMemberCapacity) {
      revert ClanIsFull();
    }

    _acceptJoinRequest(_clanId, _newMemberPlayedId);

    emit JoinRequestAccepted(_clanId, _newMemberPlayedId, _playerId);
  }

  function acceptJoinRequests(
    uint _clanId,
    uint[] calldata _newMemberPlayedIds,
    uint _playerId
  ) public isOwnerOfPlayerAndActive(_playerId) isMinimumRank(_clanId, _playerId, ClanRank.SCOUT) {
    Clan storage clan = clans[_clanId];
    Tier storage tier = tiers[clan.tierId];
    if (clan.memberCount + _newMemberPlayedIds.length > tier.maxMemberCapacity) {
      revert ClanIsFull();
    }

    for (uint i = 0; i < _newMemberPlayedIds.length; ++i) {
      _acceptJoinRequest(_clanId, _newMemberPlayedIds[i]);
    }

    emit JoinRequestsAccepted(_clanId, _newMemberPlayedIds, _playerId);
  }

  function changeRank(
    uint _clanId,
    uint _memberId,
    ClanRank _rank,
    uint _playerId
  ) public isOwnerOfPlayer(_playerId) isMemberOfClan(_clanId, _memberId) {
    ClanRank currentMemberRank = playerInfo[_memberId].rank;
    ClanRank callerRank = playerInfo[_playerId].rank;
    bool changingSelf = _memberId == _playerId;

    if (callerRank <= _rank) {
      revert ChangingRankEqualOrHigherThanSelf();
    }

    // Cannot change Rank of someone higher or equal yourself
    if (changingSelf) {
      if (callerRank < currentMemberRank) {
        revert ChangingRankOfPlayerHigherThanSelf();
      }
    } else {
      if (callerRank <= currentMemberRank) {
        revert ChangingRankOfPlayerEqualOrHigherThanSelf();
      }
    }

    if (currentMemberRank == _rank) {
      revert CannotSetSameRank();
    }

    bool isDemoting = currentMemberRank > _rank;
    if (isDemoting) {
      // Are they leaving?
      if (_rank == ClanRank.NONE) {
        _removeFromClan(_clanId, _memberId);
      } else {
        // If owner is leaving their post then we need to update the owned state
        if (currentMemberRank == ClanRank.LEADER) {
          _ownerCleared(_clanId);
        }
        _updateRank(_clanId, _memberId, _rank, _playerId);
      }
    } else {
      // Promoting
      _updateRank(_clanId, _memberId, _rank, _playerId);
    }
  }

  function changeRanks(
    uint _clanId,
    uint[] calldata _memberIds,
    ClanRank[] calldata _ranks,
    uint _playerId
  ) external isOwnerOfPlayer(_playerId) {
    for (uint i = 0; i < _memberIds.length; ++i) {
      changeRank(_clanId, _memberIds[i], _ranks[i], _playerId);
    }
  }

  function renounceOwnershipTo(
    uint _clanId,
    uint _newOwner,
    ClanRank _newRank
  ) external isOwnerOfPlayer(clans[_clanId].owner) isMemberOfClan(_clanId, _newOwner) {
    Clan storage clan = clans[_clanId];
    uint oldOwnerId = clan.owner;

    if (_newOwner == oldOwnerId) {
      revert CannotRenounceToSelf();
    }

    if (_newRank != ClanRank.NONE) {
      if (_newRank >= ClanRank.LEADER) {
        revert RankMustBeLowerRenounce();
      }
      // Change old owner to new rank
      _updateRank(_clanId, oldOwnerId, _newRank, oldOwnerId);
    } else {
      _removeFromClan(_clanId, oldOwnerId);
    }
    _claimOwnership(_clanId, _newOwner);
  }

  // Can claim a clan if there is no owner
  function claimOwnership(
    uint _clanId,
    uint _playerId
  ) external isOwnerOfPlayer(_playerId) isMemberOfClan(_clanId, _playerId) {
    Clan storage clan = clans[_clanId];
    if (clan.owner != 0) {
      revert OwnerExists();
    }

    _claimOwnership(_clanId, _playerId);
  }

  function upgradeClan(uint _clanId, uint _playerId, uint8 _newTierId) public isOwnerOfPlayer(_playerId) {
    _upgradeClan(_clanId, _playerId, _newTierId);
  }

  function getClanNameOfPlayer(uint _playerId) external view returns (string memory) {
    uint clanId = playerInfo[_playerId].clanId;
    return clans[clanId].name;
  }

  function canWithdraw(uint _clanId, uint _playerId) external view override returns (bool) {
    return playerInfo[_playerId].clanId == _clanId && playerInfo[_playerId].rank >= ClanRank.TREASURER;
  }

  function isClanMember(uint _clanId, uint _playerId) external view returns (bool) {
    return playerInfo[_playerId].clanId == _clanId;
  }

  function isMemberOfAnyClan(uint _playerId) public view returns (bool) {
    return playerInfo[_playerId].clanId != 0;
  }

  function getClanTierMembership(uint _playerId) external view returns (uint8) {
    return clans[playerInfo[_playerId].clanId].tierId;
  }

  function hasInviteRequest(uint _clanId, uint _playerId) external view returns (bool) {
    return clans[_clanId].inviteRequests[_playerId];
  }

  function maxBankCapacity(uint _clanId) external view override returns (uint16) {
    Tier storage tier = tiers[clans[_clanId].tierId];
    return tier.maxBankCapacity;
  }

  function maxMemberCapacity(uint _clanId) external view override returns (uint16) {
    Tier storage tier = tiers[clans[_clanId].tierId];
    return tier.maxMemberCapacity;
  }

  function _checkClanImage(uint _imageId, uint _maxImageId) private pure {
    if (_imageId == 0 || _imageId > _maxImageId) {
      revert InvalidImageId();
    }
  }

  function _setName(uint _clanId, string calldata _name) private returns (string memory trimmedName, bool nameChanged) {
    // Trimmed name cannot be empty
    trimmedName = EstforLibrary.trim(_name);
    if (bytes(trimmedName).length < 3) {
      revert NameTooShort();
    }
    if (bytes(trimmedName).length > 20) {
      revert NameTooLong();
    }

    if (!EstforLibrary.containsValidNameCharacters(trimmedName)) {
      revert NameInvalidCharacters();
    }

    string memory trimmedAndLowercaseName = EstforLibrary.toLower(trimmedName);
    string memory oldName = EstforLibrary.toLower(clans[_clanId].name);
    nameChanged = keccak256(abi.encodePacked(oldName)) != keccak256(abi.encodePacked(trimmedAndLowercaseName));
    if (nameChanged) {
      if (lowercaseNames[trimmedAndLowercaseName]) {
        revert NameAlreadyExists();
      }
      if (bytes(oldName).length != 0) {
        delete lowercaseNames[oldName];
      }
      lowercaseNames[trimmedAndLowercaseName] = true;
      clans[_clanId].name = trimmedName;
    }
  }

  function _checkSocials(string calldata _discord, string calldata _telegram) private pure {
    uint discordLength = bytes(_discord).length;
    if (discordLength > 25) {
      revert DiscordTooLong();
    }

    if (discordLength != 0 && discordLength < 4) {
      revert DiscordTooShort();
    }

    if (!EstforLibrary.containsValidDiscordCharacters(_discord)) {
      revert DiscordInvalidCharacters();
    }

    uint telegramLength = bytes(_telegram).length;
    if (telegramLength > 25) {
      revert TelegramTooLong();
    }

    if (!EstforLibrary.containsValidTelegramCharacters(_telegram)) {
      revert TelegramInvalidCharacters();
    }
  }

  function _createClanInfo(
    string memory _trimmedName,
    string calldata _discord,
    string calldata _telegram
  ) private pure returns (string[] memory clanInfo) {
    clanInfo = new string[](3);
    clanInfo[0] = _trimmedName;
    clanInfo[1] = _discord;
    clanInfo[2] = _telegram;
  }

  function _ownerCleared(uint _clanId) private {
    uint oldOwnerId = clans[_clanId].owner;
    clans[_clanId].owner = 0;
    ownerlessClanTimestamps[_clanId] = uint40(block.timestamp);
    emit ClanOwnerLeft(_clanId, oldOwnerId);
  }

  function _updateRank(uint _clanId, uint _memberId, ClanRank _rank, uint _playerId) private {
    PlayerInfo storage player = playerInfo[_memberId];
    player.rank = _rank;
    emit PlayerRankUpdated(_clanId, _memberId, _rank, _playerId);
  }

  function _destroyClan(uint _clanId) private {
    if (clans[_clanId].memberCount != 0) {
      // Defensive check
      revert ClanDestroyFailedHasMembers();
    }
    lowercaseNames[EstforLibrary.toLower(clans[_clanId].name)] = false; // Name can be used again
    delete clans[_clanId]; // Delete the clan
    emit ClanDestroyed(_clanId);
  }

  function _removeFromClan(uint _clanId, uint _playerId) private {
    Clan storage clan = clans[_clanId];

    if (clan.owner == _playerId) {
      _ownerCleared(_clanId);
    }

    --clan.memberCount;
    if (clan.memberCount == 0) {
      _destroyClan(_clanId);
    } else {
      emit MemberLeft(_clanId, _playerId);
    }
    PlayerInfo storage player = playerInfo[_playerId];
    player.clanId = 0;
    player.rank = ClanRank.NONE;
  }

  function _claimOwnership(uint _clanId, uint _playerId) private {
    Clan storage clan = clans[_clanId];
    clan.owner = uint80(_playerId);
    delete ownerlessClanTimestamps[_clanId];
    playerInfo[_playerId].rank = ClanRank.LEADER;
    emit ClanOwnershipTransferred(_clanId, _playerId);
  }

  function _pay(uint _brushCost) private {
    // Pay
    brush.transferFrom(msg.sender, address(this), _brushCost);
    uint quarterCost = _brushCost / 4;
    // Send half to the pool (currently shop)
    brush.transfer(pool, _brushCost - quarterCost * 2);
    // Send 1 quarter to the dev address
    brush.transfer(dev, quarterCost);
    // Burn 1 quarter
    brush.burn(quarterCost);
  }

  function _upgradeClan(uint _clanId, uint _playerId, uint8 _newTierId) private {
    Tier storage oldTier = tiers[clans[_clanId].tierId];
    if (oldTier.id == 0) {
      revert ClanDoesNotExist();
    }

    if (_newTierId <= oldTier.id) {
      revert CannotDowngradeTier();
    }

    _checkTierExists(_newTierId);

    Tier storage newTier = tiers[_newTierId];
    uint priceDifference = newTier.price - oldTier.price;
    _pay(priceDifference);

    clans[_clanId].tierId = _newTierId; // Increase the tier
    emit ClanUpgraded(_clanId, _playerId, _newTierId);
  }

  function _setTier(Tier calldata _tier) private {
    uint tierId = _tier.id;
    // TODO: Some other checks

    // Price should be higher than the one prior
    if (tierId > 1) {
      if (_tier.price < tiers[tierId - 1].price) {
        revert PriceTooLow();
      }
      if (_tier.maxMemberCapacity < tiers[tierId - 1].maxMemberCapacity) {
        revert MemberCapacityTooLow();
      }
      if (_tier.maxBankCapacity < tiers[tierId - 1].maxBankCapacity) {
        revert BankCapacityTooLow();
      }
      if (_tier.maxImageId < tiers[tierId - 1].maxImageId) {
        revert ImageIdTooLow();
      }
    }
    tiers[tierId] = _tier;
  }

  function addTiers(Tier[] calldata _tiers) external onlyOwner {
    U256 bounds = _tiers.length.asU256();
    for (U256 iter; iter < bounds; iter = iter.inc()) {
      uint i = iter.asUint256();
      if (tiers[_tiers[i].id].id != 0 || _tiers[i].id == 0) {
        revert TierAlreadyExists();
      }
      _setTier(_tiers[i]);
    }
    emit AddTiers(_tiers);
  }

  function editTiers(Tier[] calldata _tiers) external onlyOwner {
    U256 bounds = _tiers.length.asU256();
    for (U256 iter; iter < bounds; iter = iter.inc()) {
      uint i = iter.asUint256();
      _checkTierExists(_tiers[i].id);
      _setTier(_tiers[i]);
    }
    emit EditTiers(_tiers);
  }

  function setBankFactory(IBankFactory _bankFactory) external onlyOwner {
    bankFactory = _bankFactory;
  }

  function setPlayers(IPlayers _players) external onlyOwner {
    players = _players;
  }

  function setEditNameCost(uint72 _editNameCost) external onlyOwner {
    editNameCost = _editNameCost;
    emit EditNameCost(_editNameCost);
  }

  function _authorizeUpgrade(address) internal override onlyOwner {}
}
