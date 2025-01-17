// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {UUPSUpgradeable} from "./ozUpgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "./ozUpgradeable/access/OwnableUpgradeable.sol";

import {UnsafeMath, U256} from "@0xdoublesharp/unsafe-math/contracts/UnsafeMath.sol";

contract AdminAccess is UUPSUpgradeable, OwnableUpgradeable {
  using UnsafeMath for U256;
  using UnsafeMath for uint256;

  mapping(address admin => bool isAdmin) private admins;
  mapping(address admin => bool isAdmin) private promotionalAdmins;

  /// @custom:oz-upgrades-unsafe-allow constructor
  constructor() {
    _disableInitializers();
  }

  function initialize(address[] calldata _admins, address[] calldata _promotionalAdmins) public initializer {
    __Ownable_init();
    __UUPSUpgradeable_init();
    _updateAdmins(_admins, true);
    _updatePromotionalAdmins(_promotionalAdmins, true);
  }

  function addAdmins(address[] calldata _admins) external onlyOwner {
    _updateAdmins(_admins, true);
  }

  function addAdmin(address _admin) external onlyOwner {
    _updateAdmin(_admin, true);
  }

  function removeAdmin(address _admin) external onlyOwner {
    _updateAdmin(_admin, false);
  }

  function addPromotionalAdmins(address[] calldata _admins) external onlyOwner {
    _updatePromotionalAdmins(_admins, true);
  }

  function _updateAdmins(address[] calldata _admins, bool _isAdmin) internal {
    U256 bounds = _admins.length.asU256();
    for (U256 iter; iter < bounds; iter = iter.inc()) {
      admins[_admins[iter.asUint256()]] = _isAdmin;
    }
  }

  function _updatePromotionalAdmins(address[] calldata _promotionalAdmins, bool _isAdmin) internal {
    U256 bounds = _promotionalAdmins.length.asU256();
    for (U256 iter; iter < bounds; iter = iter.inc()) {
      promotionalAdmins[_promotionalAdmins[iter.asUint256()]] = _isAdmin;
    }
  }

  function _updateAdmin(address _admin, bool _isAdmin) internal {
    admins[_admin] = _isAdmin;
  }

  function isAdmin(address _admin) external view returns (bool) {
    return admins[_admin];
  }

  function isPromotionalAdmin(address _admin) external view returns (bool) {
    return promotionalAdmins[_admin];
  }

  // solhint-disable-next-line no-empty-blocks
  function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
