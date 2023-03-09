// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {PlayersUpgradeableImplDummyBase, PlayersBase} from "./PlayersImplBase.sol";
import {PlayerLibrary} from "./PlayerLibrary.sol";

import "../items.sol";
import "../types.sol";

contract PlayersImplProcessActions is PlayersUpgradeableImplDummyBase, PlayersBase {
  constructor() {
    _checkStartSlot();
  }

  function processActions(address _from, uint _playerId) external returns (QueuedAction[] memory remainingSkills) {
    Player storage player = players[_playerId];
    if (player.actionQueue.length == 0) {
      // No actions remaining
      return remainingSkills;
    }

    uint previousSkillPoints = player.totalSkillPoints;
    uint32 allPointsAccrued;

    remainingSkills = new QueuedAction[](player.actionQueue.length); // Max
    uint length;
    uint nextStartTime = block.timestamp;
    for (uint i = 0; i < player.actionQueue.length; ++i) {
      QueuedAction storage queuedAction = player.actionQueue[i];
      bool isCombat = _isCombatStyle(queuedAction.combatStyle);
      CombatStats memory combatStats;
      if (isCombat) {
        // This will only ones that they have a balance for at this time. This will check balances
        combatStats = _getCachedCombatStats(player);
        _updateCombatStats(_from, combatStats, queuedAction.attire);
      }
      bool missingRequiredHandEquipment = _updateStatsFromHandEquipment(
        _from,
        [queuedAction.rightHandEquipmentTokenId, queuedAction.leftHandEquipmentTokenId],
        combatStats,
        isCombat
      );
      if (missingRequiredHandEquipment) {
        emit ActionAborted(_playerId, queuedAction.attire.queueId);
        continue;
      }

      uint32 pointsAccrued;
      uint skillEndTime = queuedAction.startTime +
        (
          speedMultiplier[_playerId] > 1
            ? uint(queuedAction.timespan) / speedMultiplier[_playerId]
            : queuedAction.timespan
        );

      uint elapsedTime = _getElapsedTime(_playerId, skillEndTime, queuedAction);
      if (elapsedTime == 0) {
        // Haven't touched this action yet so add it all
        _addRemainingSkill(remainingSkills, queuedAction, nextStartTime, length);
        nextStartTime += queuedAction.timespan;
        length = i + 1;
        continue;
      }

      bool fullyFinished = elapsedTime >= queuedAction.timespan;

      // Create some items if necessary (smithing ores to bars for instance)
      bool died;

      ActionChoice memory actionChoice;

      uint xpElapsedTime = elapsedTime;

      if (queuedAction.choiceId != 0) {
        // Includes combat
        uint combatElapsedTime;
        actionChoice = world.getActionChoice(isCombat ? NONE : queuedAction.actionId, queuedAction.choiceId);

        (xpElapsedTime, combatElapsedTime, died) = _processConsumables(
          _from,
          _playerId,
          queuedAction,
          elapsedTime,
          combatStats,
          actionChoice
        );
      }

      uint128 _queueId = queuedAction.attire.queueId;
      Skill skill = _getSkillFromStyle(queuedAction.combatStyle, queuedAction.actionId);

      if (!died) {
        pointsAccrued = _getPointsAccrued(_from, _playerId, queuedAction, skill, xpElapsedTime);
      } else {
        emit Died(_from, _playerId, _queueId);
      }

      if (!fullyFinished) {
        // Add the remainder if this action is not fully consumed
        _addRemainingSkill(remainingSkills, queuedAction, nextStartTime, length);
        nextStartTime += elapsedTime;
        length = i + 1;
      }

      if (pointsAccrued != 0) {
        if (_isCombatStyle(queuedAction.combatStyle)) {
          // Update health too with 33% of the points gained from combat
          _updateSkillPoints(_playerId, Skill.HEALTH, (pointsAccrued * 33) / 100);
          _cacheCombatStats(
            players[_playerId],
            skillPoints[_playerId][Skill.HEALTH],
            skill,
            skillPoints[_playerId][skill]
          );
        }
        _updateSkillPoints(_playerId, skill, pointsAccrued);

        (uint[] memory newIds, uint[] memory newAmounts) = _getRewards(
          uint40(queuedAction.startTime + xpElapsedTime),
          xpElapsedTime,
          queuedAction.actionId
        );

        ActionRewards memory actionRewards = world.getActionRewards(queuedAction.actionId);
        _addPendingRandomReward(
          pendingRandomRewards[_playerId],
          actionRewards,
          queuedAction.actionId,
          _queueId,
          uint40(skillEndTime),
          uint24(xpElapsedTime)
        );

        // This loot might be needed for a future task so mint now rather than later
        // But this could be improved
        if (newIds.length != 0) {
          itemNFT.mintBatch(_from, newIds, newAmounts);
          emit Rewards(_from, _playerId, _queueId, newIds, newAmounts);
        }

        allPointsAccrued += pointsAccrued;
      }

      if (fullyFinished) {
        emit ActionFinished(_from, _playerId, _queueId);
      } else {
        emit ActionPartiallyFinished(_from, _playerId, _queueId, elapsedTime);
      }
    }

    if (allPointsAccrued != 0) {
      _handleTotalXPThresholdRewards(_from, previousSkillPoints, previousSkillPoints + allPointsAccrued);
      player.totalSkillPoints = uint160(previousSkillPoints + allPointsAccrued);
    }

    _claimRandomRewards(_playerId);

    assembly ("memory-safe") {
      mstore(remainingSkills, length)
    }
  }

  function _processConsumables(
    address _from,
    uint _playerId,
    QueuedAction storage _queuedAction,
    uint _elapsedTime,
    CombatStats memory _combatStats,
    ActionChoice memory _actionChoice
  ) private returns (uint xpElapsedTime, uint combatElapsedTime, bool died) {
    bool isCombat = _isCombatStyle(_queuedAction.combatStyle);
    uint16 numConsumed;

    if (isCombat) {
      CombatStats memory _enemyCombatStats = world.getCombatStats(_queuedAction.actionId);
      (xpElapsedTime, combatElapsedTime, numConsumed) = PlayerLibrary.getCombatAdjustedElapsedTimes(
        _from,
        itemNFT,
        world,
        _elapsedTime,
        _actionChoice,
        _queuedAction,
        _combatStats,
        _enemyCombatStats,
        alphaCombat,
        betaCombat
      );

      (died) = _processFoodConsumed(
        _from,
        _playerId,
        _queuedAction,
        combatElapsedTime,
        _combatStats,
        _enemyCombatStats
      );
    } else {
      (xpElapsedTime, numConsumed) = PlayerLibrary.getNonCombatAdjustedElapsedTime(
        _from,
        itemNFT,
        _elapsedTime,
        _actionChoice
      );
    }

    if (numConsumed != 0) {
      _processInputConsumables(_from, _playerId, _actionChoice, numConsumed, _queuedAction.attire.queueId);
    }

    if (_actionChoice.outputTokenId != 0) {
      itemNFT.mint(_from, _actionChoice.outputTokenId, numConsumed);
      emit Reward(_from, _playerId, _queuedAction.attire.queueId, _actionChoice.outputTokenId, numConsumed);
    }
  }

  function _processInputConsumables(
    address _from,
    uint _playerId,
    ActionChoice memory _actionChoice,
    uint16 _numConsumed,
    uint128 _queueId
  ) private {
    _processConsumable(_from, _playerId, _actionChoice.inputTokenId1, _numConsumed * _actionChoice.num1, _queueId);
    _processConsumable(_from, _playerId, _actionChoice.inputTokenId2, _numConsumed * _actionChoice.num2, _queueId);
    _processConsumable(_from, _playerId, _actionChoice.inputTokenId3, _numConsumed * _actionChoice.num3, _queueId);
  }

  function _processConsumable(
    address _from,
    uint _playerId,
    uint16 _itemTokenId,
    uint16 _numConsumed,
    uint128 _queueId
  ) private {
    if (_itemTokenId == 0) {
      return;
    }
    // Balance should be checked beforehand
    emit Consume(_from, _playerId, _queueId, _itemTokenId, _numConsumed);
    itemNFT.burn(_from, _itemTokenId, _numConsumed);
  }

  function _processFoodConsumed(
    address _from,
    uint _playerId,
    QueuedAction storage _queuedAction,
    uint _combatElapsedTime,
    CombatStats memory _combatStats,
    CombatStats memory _enemyCombatStats
  ) private returns (bool died) {
    uint16 foodConsumed;
    // Figure out how much food should be used
    (foodConsumed, died) = PlayerLibrary.foodConsumedView(
      _from,
      _queuedAction,
      _combatElapsedTime,
      itemNFT,
      _combatStats,
      _enemyCombatStats,
      alphaCombat,
      betaCombat
    );

    _processConsumable(_from, _playerId, _queuedAction.regenerateId, foodConsumed, _queuedAction.attire.queueId);
  }

  function _cacheCombatStats(
    Player storage _player,
    uint32 _healthSkillPoints,
    Skill _skill,
    uint32 _skillPoints
  ) private {
    {
      int16 _health = int16(PlayerLibrary.getLevel(_healthSkillPoints));
      _player.health = _health;
    }

    int16 _level = int16(PlayerLibrary.getLevel(_skillPoints));
    if (_skill == Skill.ATTACK) {
      _player.melee = _level;
    } else if (_skill == Skill.MAGIC) {
      _player.magic = _level;
    }
    /* else if (_skill == Skill.RANGE) {
            _player.range = _level;
          } */
    else if (_skill == Skill.DEFENCE) {
      _player.defence = _level;
    }
  }

  function _getSkillFromStyle(CombatStyle _combatStyle, uint16 _actionId) private view returns (Skill skill) {
    if (_combatStyle == CombatStyle.MELEE) {
      skill = Skill.ATTACK;
    } else if (_combatStyle == CombatStyle.MAGIC) {
      skill = Skill.MAGIC;
    }
    /* else if (_combatStyle == Skill.RANGE) {
            skill = Skill.RANGE;
          } */
    else if (
      _combatStyle == CombatStyle.MELEE_DEFENCE ||
      _combatStyle == CombatStyle.RANGE_DEFENCE ||
      _combatStyle == CombatStyle.MAGIC_DEFENCE
    ) {
      skill = Skill.DEFENCE;
    } else {
      // Not a combat style, get the skill from the action
      skill = world.getSkill(_actionId);
    }
  }

  function _getRewards(
    uint40 _skillEndTime,
    uint _elapsedTime,
    uint16 _actionId
  ) private returns (uint[] memory newIds, uint[] memory newAmounts) {
    bytes memory data = _delegatecall(
      implRewards,
      abi.encodeWithSignature("getRewards(uint40,uint256,uint16)", _skillEndTime, _elapsedTime, _actionId)
    );
    return abi.decode(data, (uint[], uint[]));
  }

  function _addRemainingSkill(
    QueuedAction[] memory remainingSkills,
    QueuedAction storage queuedAction,
    uint prevEndTime,
    uint length
  ) private view {
    uint40 end = queuedAction.startTime + queuedAction.timespan;

    QueuedAction memory remainingAction = queuedAction;
    remainingAction.startTime = uint40(prevEndTime);
    remainingAction.timespan = uint16(end - prevEndTime);

    // Build a list of the skills queued that remain
    remainingSkills[length] = remainingAction;
  }

  function _updateSkillPoints(uint _playerId, Skill _skill, uint32 _pointsAccrued) private {
    uint32 oldPoints = skillPoints[_playerId][_skill];
    uint32 newPoints = oldPoints + _pointsAccrued;
    skillPoints[_playerId][_skill] = newPoints;
    emit AddSkillPoints(_playerId, _skill, _pointsAccrued);

    uint16 oldLevel = PlayerLibrary.getLevel(oldPoints);
    uint16 newLevel = PlayerLibrary.getLevel(newPoints);
    // Update the player's level
    if (newLevel > oldLevel) {
      emit LevelUp(_playerId, _skill, newLevel);
    }
  }

  function _addPendingRandomReward(
    PendingRandomReward[] storage _pendingRandomRewards,
    ActionRewards memory _actionRewards,
    uint16 _actionId,
    uint128 _queueId,
    uint40 _skillEndTime,
    uint24 _elapsedTime
  ) private {
    bool hasRandomRewards = _actionRewards.randomRewardTokenId1 != NONE; // A precheck as an optimization
    if (hasRandomRewards) {
      bool hasSeed = world.hasSeed(_skillEndTime);
      if (!hasSeed) {
        // There's no seed for this yet, so add it to the loot queue. (TODO: They can force add it later)
        _pendingRandomRewards.push(
          PendingRandomReward({
            actionId: _actionId,
            queueId: _queueId,
            timestamp: uint40(_skillEndTime),
            elapsedTime: uint24(_elapsedTime)
          })
        );
        emit AddPendingRandomReward(_actionId, _skillEndTime, _elapsedTime);
      }
    }
  }

  function _claimableXPThresholdRewards(
    uint _oldTotalSkillPoints,
    uint _newTotalSkillPoints
  ) private returns (uint[] memory ids, uint[] memory amounts) {
    bytes memory data = _delegatecall(
      implRewards,
      abi.encodeWithSignature(
        "claimableXPThresholdRewards(uint256,uint256)",
        _oldTotalSkillPoints,
        _newTotalSkillPoints
      )
    );
    return abi.decode(data, (uint[], uint[]));
  }

  function _handleTotalXPThresholdRewards(address _from, uint _oldTotalSkillPoints, uint _newTotalSkillPoints) private {
    (uint[] memory itemTokenIds, uint[] memory amounts) = _claimableXPThresholdRewards(
      _oldTotalSkillPoints,
      _newTotalSkillPoints
    );
    if (itemTokenIds.length != 0) {
      itemNFT.mintBatch(_from, itemTokenIds, amounts);
      emit XPThresholdRewards(itemTokenIds, amounts);
    }
  }
}
