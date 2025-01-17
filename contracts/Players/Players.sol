// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {UUPSUpgradeable} from "../ozUpgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "../ozUpgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "../ozUpgradeable/security/ReentrancyGuardUpgradeable.sol";

import {UnsafeMath, U256} from "@0xdoublesharp/unsafe-math/contracts/UnsafeMath.sol";

import {World} from "../World.sol";
import {ItemNFT} from "../ItemNFT.sol";
import {AdminAccess} from "../AdminAccess.sol";
import {Quests} from "../Quests.sol";
import {Clans} from "../Clans/Clans.sol";
import {PlayerNFT} from "../PlayerNFT.sol";
import {PlayersBase} from "./PlayersBase.sol";
import {PlayersLibrary} from "./PlayersLibrary.sol";
import {IPlayers} from "../interfaces/IPlayers.sol";
import {IPlayersMiscDelegateView, IPlayersRewardsDelegateView, IPlayersQueuedActionsDelegateView, IPlayersProcessActionsDelegate, IPlayersMisc1DelegateView} from "../interfaces/IPlayersDelegates.sol";

// solhint-disable-next-line no-global-import
import "../globals/all.sol";

// Functions to help with delegatecall selectors
interface IPlayerDelegate {
  function startActions(
    uint playerId,
    QueuedActionInput[] calldata queuedActions,
    uint16 boostItemTokenId,
    uint40 boostStartTime,
    uint questId,
    ActionQueueStatus queueStatus
  ) external;

  function addXPThresholdRewards(XPThresholdReward[] calldata xpThresholdRewards) external;

  function editXPThresholdRewards(XPThresholdReward[] calldata xpThresholdRewards) external;

  function addFullAttireBonuses(FullAttireBonusInput[] calldata fullAttireBonuses) external;

  function mintedPlayer(
    address from,
    uint playerId,
    Skill[2] calldata startSkills,
    uint[] calldata startingItemTokenIds,
    uint[] calldata startingAmounts
  ) external;

  function clearEverything(address from, uint playerId, bool processTheTransactions) external;

  function setActivePlayer(address from, uint playerId) external;

  function testModifyXP(address from, uint playerId, Skill skill, uint56 xp, bool force) external;

  function buyBrushQuest(address to, uint playerId, uint questId, bool useExactETH) external;

  function initialize(
    ItemNFT itemNFT,
    PlayerNFT playerNFT,
    World world,
    AdminAccess adminAccess,
    Quests quests,
    Clans clans,
    address implQueueActions,
    address implProcessActions,
    address implRewards,
    address implMisc,
    address implMisc1,
    bool isBeta
  ) external;
}

contract Players is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable, PlayersBase, IPlayers {
  using UnsafeMath for U256;

  event GamePaused(bool gamePaused);

  error InvalidSelector();
  error GameIsPaused();
  error NotBeta();

  modifier isOwnerOfPlayerAndActiveMod(uint _playerId) {
    if (!isOwnerOfPlayerAndActive(msg.sender, _playerId)) {
      revert NotOwnerOfPlayerAndActive();
    }
    _;
  }

  modifier isOwnerOfPlayerMod(uint playerId) {
    if (playerNFT.balanceOf(msg.sender, playerId) != 1) {
      revert NotOwnerOfPlayer();
    }
    _;
  }

  modifier isBetaMod() {
    if (!isBeta) {
      revert NotBeta();
    }
    _;
  }

  modifier gameNotPaused() {
    if (gamePaused) {
      revert GameIsPaused();
    }
    _;
  }

  /// @custom:oz-upgrades-unsafe-allow constructor
  constructor() {
    _disableInitializers();
    _checkStartSlot();
  }

  function initialize(
    ItemNFT _itemNFT,
    PlayerNFT _playerNFT,
    World _world,
    AdminAccess _adminAccess,
    Quests _quests,
    Clans _clans,
    address _implQueueActions,
    address _implProcessActions,
    address _implRewards,
    address _implMisc,
    address _implMisc1,
    bool _isBeta
  ) public initializer {
    __Ownable_init();
    __UUPSUpgradeable_init();
    __ReentrancyGuard_init();

    _delegatecall(
      _implMisc1,
      abi.encodeWithSelector(
        IPlayerDelegate.initialize.selector,
        _itemNFT,
        _playerNFT,
        _world,
        _adminAccess,
        _quests,
        _clans,
        _implQueueActions,
        _implProcessActions,
        _implRewards,
        _implMisc,
        _implMisc1,
        _isBeta
      )
    );
  }

  /// @notice Start actions for a player
  /// @param _playerId Id for the player
  /// @param _queuedActions Actions to queue
  /// @param _queueStatus Can be either `ActionQueueStatus.NONE` for overwriting all actions,
  ///                     `ActionQueueStatus.KEEP_LAST_IN_PROGRESS` or `ActionQueueStatus.APPEND`
  function startActions(
    uint _playerId,
    QueuedActionInput[] calldata _queuedActions,
    ActionQueueStatus _queueStatus
  ) external isOwnerOfPlayerAndActiveMod(_playerId) nonReentrant gameNotPaused {
    _startActions(_playerId, _queuedActions, NONE, uint40(block.timestamp), 0, _queueStatus);
  }

  /// @notice Start actions for a player
  /// @param _playerId Id for the player
  /// @param _queuedActions Actions to queue
  /// @param _boostItemTokenId Which boost to consume, can be NONE
  /// @param _boostStartTime (Not used yet)
  /// @param _queueStatus Can be either `ActionQueueStatus.NONE` for overwriting all actions,
  ///                     `ActionQueueStatus.KEEP_LAST_IN_PROGRESS` or `ActionQueueStatus.APPEND`
  function startActionsExtra(
    uint _playerId,
    QueuedActionInput[] calldata _queuedActions,
    uint16 _boostItemTokenId,
    uint40 _boostStartTime, // Not used yet (always current time)
    uint _questId,
    ActionQueueStatus _queueStatus
  ) external isOwnerOfPlayerAndActiveMod(_playerId) nonReentrant gameNotPaused {
    _startActions(_playerId, _queuedActions, _boostItemTokenId, uint40(block.timestamp), _questId, _queueStatus);
  }

  /// @notice Process actions for a player up to the current block timestamp
  function processActions(uint _playerId) external isOwnerOfPlayerAndActiveMod(_playerId) nonReentrant gameNotPaused {
    _processActionsAndSetState(_playerId);
  }

  // Callback after minting a player
  function mintedPlayer(
    address _from,
    uint _playerId,
    Skill[2] calldata _startSkills,
    bool _makeActive,
    uint[] calldata _startingItemTokenIds,
    uint[] calldata _startingAmounts
  ) external override onlyPlayerNFT {
    if (_makeActive) {
      _setActivePlayer(_from, _playerId);
    }

    _delegatecall(
      implMisc,
      abi.encodeWithSelector(
        IPlayerDelegate.mintedPlayer.selector,
        _from,
        _playerId,
        _startSkills,
        _startingItemTokenIds,
        _startingAmounts
      )
    );
  }

  // This is a special type of quest.
  function buyBrushQuest(
    address _to,
    uint _playerId,
    uint _questId,
    bool _useExactETH
  ) external payable isOwnerOfPlayerAndActiveMod(_playerId) nonReentrant gameNotPaused {
    _delegatecall(
      implMisc,
      abi.encodeWithSelector(IPlayerDelegate.buyBrushQuest.selector, _to, _playerId, _questId, _useExactETH)
    );
  }

  function activateQuest(
    uint _playerId,
    uint questId
  ) external isOwnerOfPlayerAndActiveMod(_playerId) nonReentrant gameNotPaused {
    if (players_[_playerId].actionQueue.length != 0) {
      _processActionsAndSetState(_playerId);
    }
    quests.activateQuest(_playerId, questId);
  }

  function deactivateQuest(uint _playerId) external isOwnerOfPlayerAndActiveMod(_playerId) nonReentrant gameNotPaused {
    if (players_[_playerId].actionQueue.length != 0) {
      _processActionsAndSetState(_playerId);
    }
    // Quest may hve been completed as a result of this so don't bother trying to deactivate it
    if (quests.getActiveQuestId(_playerId) != 0) {
      quests.deactivateQuest(_playerId);
    }
  }

  /// @notice Called by the PlayerNFT contract before a player is transferred
  /// @param _from The owner of the player being transferred
  /// @param _playerId The id of the player being transferred
  function clearEverythingBeforeTokenTransfer(address _from, uint _playerId) external override onlyPlayerNFT {
    _clearEverything(_from, _playerId, true);
    // If it was the active player, then clear it
    uint existingActivePlayerId = activePlayer_[_from];
    if (existingActivePlayerId == _playerId) {
      delete activePlayer_[_from];
      emit SetActivePlayer(_from, existingActivePlayerId, 0);
    }
  }

  function clearEverything(uint _playerId) external isOwnerOfPlayerAndActiveMod(_playerId) isBetaMod {
    address from = msg.sender;
    bool isEmergency = true;
    _clearEverything(from, _playerId, !isEmergency);
  }

  function _clearEverything(address _from, uint _playerId, bool _processTheActions) private {
    _delegatecall(
      implQueueActions,
      abi.encodeWithSelector(IPlayerDelegate.clearEverything.selector, _from, _playerId, _processTheActions)
    );
  }

  function _startActions(
    uint _playerId,
    QueuedActionInput[] memory _queuedActions,
    uint16 _boostItemTokenId,
    uint40 _boostStartTime,
    uint _questId,
    ActionQueueStatus _queueStatus
  ) private {
    _delegatecall(
      implQueueActions,
      abi.encodeWithSelector(
        IPlayerDelegate.startActions.selector,
        _playerId,
        _queuedActions,
        _boostItemTokenId,
        _boostStartTime,
        _questId,
        _queueStatus
      )
    );
  }

  function _processActionsAndSetState(uint _playerId) private {
    _delegatecall(
      implProcessActions,
      abi.encodeWithSelector(IPlayersProcessActionsDelegate.processActionsAndSetState.selector, _playerId)
    );
  }

  function _setActivePlayer(address _from, uint _playerId) private {
    _delegatecall(implQueueActions, abi.encodeWithSelector(IPlayerDelegate.setActivePlayer.selector, _from, _playerId));
  }

  function setActivePlayer(uint _playerId) external isOwnerOfPlayerMod(_playerId) {
    _setActivePlayer(msg.sender, _playerId);
  }

  function dailyClaimedRewards(uint _playerId) external view returns (bool[7] memory claimed) {
    bytes memory data = _staticcall(
      address(this),
      abi.encodeWithSelector(IPlayersMiscDelegateView.dailyClaimedRewardsImpl.selector, _playerId)
    );
    return abi.decode(data, (bool[7]));
  }

  /// @notice Validate if these actions can occur
  /// @param _playerId Id for the player
  /// @param _queuedActions Actions to queue
  function validateActions(
    address _owner,
    uint _playerId,
    QueuedActionInput[] calldata _queuedActions
  ) external view returns (bool[] memory successes, bytes[] memory reasons) {
    bytes memory data = _staticcall(
      address(this),
      abi.encodeWithSelector(
        IPlayersQueuedActionsDelegateView.validateActionsImpl.selector,
        _owner,
        _playerId,
        _queuedActions
      )
    );
    return abi.decode(data, (bool[], bytes[]));
  }

  function isOwnerOfPlayerAndActive(address _from, uint _playerId) public view override returns (bool) {
    return playerNFT.balanceOf(_from, _playerId) == 1 && activePlayer_[_from] == _playerId;
  }

  function getPendingRandomRewards(uint _playerId) external view returns (PendingRandomReward[] memory) {
    return pendingRandomRewards[_playerId];
  }

  function getActionQueue(uint _playerId) external view returns (QueuedAction[] memory) {
    return players_[_playerId].actionQueue;
  }

  function getURI(
    uint _playerId,
    string calldata _name,
    string calldata _avatarName,
    string calldata _avatarDescription,
    string calldata imageURI
  ) external view override returns (string memory) {
    bytes memory data = _staticcall(
      address(this),
      abi.encodeWithSelector(
        IPlayersMisc1DelegateView.uri.selector,
        _name,
        _avatarName,
        _avatarDescription,
        imageURI,
        isBeta,
        _playerId,
        clans.getClanNameOfPlayer(_playerId)
      )
    );
    return abi.decode(data, (string));
  }

  // Staticcall into ourselves and hit the fallback. This is done so that pendingQueuedActionState/dailyClaimedRewards can be exposed on the json abi.
  function pendingQueuedActionState(
    address _owner,
    uint _playerId
  ) public view returns (PendingQueuedActionState memory) {
    bytes memory data = _staticcall(
      address(this),
      abi.encodeWithSelector(IPlayersRewardsDelegateView.pendingQueuedActionStateImpl.selector, _owner, _playerId)
    );
    return abi.decode(data, (PendingQueuedActionState));
  }

  function activePlayer(address _owner) external view override returns (uint playerId) {
    return activePlayer_[_owner];
  }

  function xp(uint _playerId, Skill _skill) external view returns (uint) {
    return PlayersLibrary.readXP(_skill, xp_[_playerId]);
  }

  function players(uint _playerId) external view returns (Player memory) {
    return players_[_playerId];
  }

  function RANDOM_REWARD_CHANCE_MULTIPLIER_CUTOFF() external pure returns (uint) {
    return RANDOM_REWARD_CHANCE_MULTIPLIER_CUTOFF_;
  }

  function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

  function setImpls(
    address _implQueueActions,
    address _implProcessActions,
    address _implRewards,
    address _implMisc,
    address _implMisc1
  ) external onlyOwner {
    implQueueActions = _implQueueActions;
    implProcessActions = _implProcessActions;
    implRewards = _implRewards;
    implMisc = _implMisc;
    implMisc1 = _implMisc1;
  }

  function addXPThresholdRewards(XPThresholdReward[] calldata _xpThresholdRewards) external onlyOwner {
    _delegatecall(
      implMisc,
      abi.encodeWithSelector(IPlayerDelegate.addXPThresholdRewards.selector, _xpThresholdRewards)
    );
  }

  function editXPThresholdRewards(XPThresholdReward[] calldata _xpThresholdRewards) external onlyOwner {
    _delegatecall(
      implMisc,
      abi.encodeWithSelector(IPlayerDelegate.editXPThresholdRewards.selector, _xpThresholdRewards)
    );
  }

  function setDailyRewardsEnabled(bool _dailyRewardsEnabled) external onlyOwner {
    dailyRewardsEnabled = _dailyRewardsEnabled;
  }

  function pauseGame(bool _gamePaused) external onlyOwner {
    gamePaused = _gamePaused;
    emit GamePaused(_gamePaused);
  }

  function addFullAttireBonuses(FullAttireBonusInput[] calldata _fullAttireBonuses) external onlyOwner {
    _delegatecall(implMisc1, abi.encodeWithSelector(IPlayerDelegate.addFullAttireBonuses.selector, _fullAttireBonuses));
  }

  function testModifyXP(address _from, uint _playerId, Skill _skill, uint56 _xp, bool _force) external isAdminAndBeta {
    _delegatecall(
      implProcessActions,
      abi.encodeWithSelector(IPlayerDelegate.testModifyXP.selector, _from, _playerId, _skill, _xp, _force)
    );
  }

  // For the various view functions that require delegatecall
  fallback() external {
    bytes4 selector = bytes4(msg.data);

    address implementation;
    if (selector == IPlayersRewardsDelegateView.pendingQueuedActionStateImpl.selector) {
      implementation = implRewards;
    } else if (
      selector == IPlayersMiscDelegateView.claimableXPThresholdRewardsImpl.selector ||
      selector == IPlayersMiscDelegateView.dailyClaimedRewardsImpl.selector ||
      selector == IPlayersMiscDelegateView.dailyRewardsViewImpl.selector ||
      selector == IPlayersMiscDelegateView.processConsumablesView.selector ||
      selector == IPlayersMiscDelegateView.getRandomRewards.selector
    ) {
      implementation = implMisc;
    } else if (
      selector == IPlayersQueuedActionsDelegateView.validateActionsImpl.selector ||
      selector == IPlayersQueuedActionsDelegateView.checkAddToQueue.selector
    ) {
      implementation = implQueueActions;
    } else if (selector == IPlayersMisc1DelegateView.uri.selector) {
      implementation = implMisc1;
    } else {
      revert InvalidSelector();
    }

    assembly ("memory-safe") {
      calldatacopy(0, 0, calldatasize())
      let result := delegatecall(gas(), implementation, 0, calldatasize(), 0, 0)
      returndatacopy(0, 0, returndatasize())
      switch result
      case 0 {
        revert(0, returndatasize())
      }
      default {
        return(0, returndatasize())
      }
    }
  }
}
