/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

export interface ContractTemplate {
	id: string;
	name: string;
	category: string;
	description: string;
	fileName: string;
	source: string;
}

const PRAGMA = '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\n\n';

export const TEMPLATES: ContractTemplate[] = [

	// ── ERC20 ─────────────────────────────────────────────────────────────────
	{
		id: 'erc20-basic',
		name: 'ERC20 Token',
		category: 'Tokens',
		description: 'Standard ERC20 token with mint/burn and Ownable access control.',
		fileName: 'MyToken.sol',
		source: `${PRAGMA}import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MyToken
/// @notice Basic ERC20 token with owner-controlled minting and public burning.
contract MyToken is ERC20, ERC20Burnable, Ownable {
    constructor(address initialOwner)
        ERC20("MyToken", "MTK")
        Ownable(initialOwner)
    {}

    /// @notice Mint new tokens. Only callable by the owner.
    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }
}
`,
	},

	{
		id: 'erc20-capped',
		name: 'ERC20 Capped Supply',
		category: 'Tokens',
		description: 'ERC20 with a maximum supply cap and pausable transfers.',
		fileName: 'CappedToken.sol',
		source: `${PRAGMA}import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Capped} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import {ERC20Pausable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title CappedToken
/// @notice ERC20 with a hard cap on total supply and admin-controlled pause.
contract CappedToken is ERC20Capped, ERC20Pausable, Ownable {
    constructor(address initialOwner, uint256 cap)
        ERC20("CappedToken", "CTKN")
        ERC20Capped(cap)
        Ownable(initialOwner)
    {}

    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function _update(address from, address to, uint256 value)
        internal override(ERC20Capped, ERC20Pausable)
    {
        super._update(from, to, value);
    }
}
`,
	},

	// ── ERC721 ────────────────────────────────────────────────────────────────
	{
		id: 'erc721-basic',
		name: 'ERC721 NFT',
		category: 'NFTs',
		description: 'ERC721 NFT with URI storage, enumerable support, and Ownable mint.',
		fileName: 'MyNFT.sol',
		source: `${PRAGMA}import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MyNFT
/// @notice ERC721 NFT with per-token URI storage and enumerable support.
contract MyNFT is ERC721URIStorage, ERC721Enumerable, Ownable {
    uint256 private _nextTokenId;

    constructor(address initialOwner)
        ERC721("MyNFT", "MNFT")
        Ownable(initialOwner)
    {}

    /// @notice Mint a new NFT with a token URI.
    function safeMint(address to, string memory uri) public onlyOwner returns (uint256) {
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        return tokenId;
    }

    function _update(address to, uint256 tokenId, address auth)
        internal override(ERC721, ERC721Enumerable)
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value)
        internal override(ERC721, ERC721Enumerable)
    {
        super._increaseBalance(account, value);
    }

    function tokenURI(uint256 tokenId)
        public view override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721URIStorage, ERC721Enumerable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
`,
	},

	// ── ERC1155 ───────────────────────────────────────────────────────────────
	{
		id: 'erc1155-basic',
		name: 'ERC1155 Multi-Token',
		category: 'NFTs',
		description: 'ERC1155 multi-token contract with Ownable minting and URI support.',
		fileName: 'MyMultiToken.sol',
		source: `${PRAGMA}import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Burnable} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Burnable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MyMultiToken
/// @notice ERC1155 multi-token with owner-controlled minting.
contract MyMultiToken is ERC1155, ERC1155Burnable, Ownable {
    constructor(address initialOwner)
        ERC1155("https://api.example.com/token/{id}.json")
        Ownable(initialOwner)
    {}

    function setURI(string memory newuri) public onlyOwner {
        _setURI(newuri);
    }

    function mint(address to, uint256 id, uint256 amount, bytes memory data) public onlyOwner {
        _mint(to, id, amount, data);
    }

    function mintBatch(address to, uint256[] memory ids, uint256[] memory amounts, bytes memory data)
        public onlyOwner
    {
        _mintBatch(to, ids, amounts, data);
    }
}
`,
	},

	// ── ERC4626 ───────────────────────────────────────────────────────────────
	{
		id: 'erc4626-vault',
		name: 'ERC4626 Tokenized Vault',
		category: 'DeFi',
		description: 'ERC4626 tokenized vault for yield strategies with deposit/withdraw.',
		fileName: 'MyVault.sol',
		source: `${PRAGMA}import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title MyVault
/// @notice ERC4626-compliant tokenized vault. Override totalAssets() to include yield.
contract MyVault is ERC4626 {
    constructor(IERC20 asset_)
        ERC20("My Vault Shares", "vSHARE")
        ERC4626(asset_)
    {}

    /// @notice Returns total assets managed by this vault.
    /// @dev Override to include any yield accrued in an external strategy.
    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }
}
`,
	},

	// ── Proxy Patterns ────────────────────────────────────────────────────────
	{
		id: 'uups-proxy',
		name: 'UUPS Upgradeable Contract',
		category: 'Proxy',
		description: 'UUPS upgradeable contract using OpenZeppelin Initializable + UUPSUpgradeable.',
		fileName: 'MyUpgradeable.sol',
		source: `${PRAGMA}import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/// @title MyUpgradeable
/// @notice UUPS upgradeable contract. Deploy via ERC1967Proxy pointing to this implementation.
/// @dev Call initialize() after deployment via proxy. Constructor only disables initializers.
contract MyUpgradeable is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    /// @custom:storage-location erc7201:mycontract.main
    struct MainStorage {
        uint256 value;
    }

    bytes32 private constant MAIN_SLOT =
        keccak256(abi.encode(uint256(keccak256("mycontract.main")) - 1)) & ~bytes32(uint256(0xff));

    function _getMainStorage() private pure returns (MainStorage storage $) {
        assembly { $.slot := MAIN_SLOT }
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner) public initializer {
        __Ownable_init(initialOwner);
        __UUPSUpgradeable_init();
    }

    function getValue() external view returns (uint256) {
        return _getMainStorage().value;
    }

    function setValue(uint256 newValue) external onlyOwner {
        _getMainStorage().value = newValue;
    }

    function _authorizeUpgrade(address newImplementation)
        internal override onlyOwner {}
}
`,
	},

	// ── DeFi ──────────────────────────────────────────────────────────────────
	{
		id: 'multisig',
		name: 'Multisig Wallet',
		category: 'DeFi',
		description: 'Simple M-of-N multisig wallet with proposal, approval, and execution.',
		fileName: 'MultiSig.sol',
		source: `${PRAGMA}/// @title MultiSig
/// @notice Simple M-of-N multi-signature wallet.
contract MultiSig {
    event Submitted(uint256 indexed txId, address indexed proposer, address to, uint256 value);
    event Approved(uint256 indexed txId, address indexed owner);
    event Executed(uint256 indexed txId);
    event Revoked(uint256 indexed txId, address indexed owner);

    error NotOwner();
    error TxNotExists();
    error TxAlreadyExecuted();
    error AlreadyApproved();
    error NotApproved();
    error NotEnoughApprovals();
    error ExecutionFailed();
    error InvalidOwners();
    error InvalidRequired();

    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
    }

    address[] public owners;
    mapping(address => bool) public isOwner;
    uint256 public required;

    Transaction[] public transactions;
    mapping(uint256 => mapping(address => bool)) public approved;

    modifier onlyOwner() {
        if (!isOwner[msg.sender]) revert NotOwner();
        _;
    }

    modifier txExists(uint256 txId) {
        if (txId >= transactions.length) revert TxNotExists();
        _;
    }

    modifier notExecuted(uint256 txId) {
        if (transactions[txId].executed) revert TxAlreadyExecuted();
        _;
    }

    constructor(address[] memory _owners, uint256 _required) {
        if (_owners.length == 0) revert InvalidOwners();
        if (_required == 0 || _required > _owners.length) revert InvalidRequired();
        for (uint256 i = 0; i < _owners.length; i++) {
            address owner = _owners[i];
            require(owner != address(0) && !isOwner[owner], "invalid owner");
            isOwner[owner] = true;
            owners.push(owner);
        }
        required = _required;
    }

    receive() external payable {}

    function submit(address to, uint256 value, bytes calldata data) external onlyOwner returns (uint256) {
        uint256 txId = transactions.length;
        transactions.push(Transaction({ to: to, value: value, data: data, executed: false }));
        emit Submitted(txId, msg.sender, to, value);
        return txId;
    }

    function approve(uint256 txId) external onlyOwner txExists(txId) notExecuted(txId) {
        if (approved[txId][msg.sender]) revert AlreadyApproved();
        approved[txId][msg.sender] = true;
        emit Approved(txId, msg.sender);
    }

    function revoke(uint256 txId) external onlyOwner txExists(txId) notExecuted(txId) {
        if (!approved[txId][msg.sender]) revert NotApproved();
        approved[txId][msg.sender] = false;
        emit Revoked(txId, msg.sender);
    }

    function execute(uint256 txId) external txExists(txId) notExecuted(txId) {
        if (_approvalCount(txId) < required) revert NotEnoughApprovals();
        Transaction storage transaction = transactions[txId];
        transaction.executed = true;
        (bool success, ) = transaction.to.call{value: transaction.value}(transaction.data);
        if (!success) revert ExecutionFailed();
        emit Executed(txId);
    }

    function _approvalCount(uint256 txId) internal view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (approved[txId][owners[i]]) count++;
        }
    }

    function getTransaction(uint256 txId) external view returns (Transaction memory) {
        return transactions[txId];
    }

    function transactionCount() external view returns (uint256) {
        return transactions.length;
    }
}
`,
	},

	// ── Governance ────────────────────────────────────────────────────────────
	{
		id: 'governor',
		name: 'Governor + Timelock',
		category: 'Governance',
		description: 'OpenZeppelin Governor with TimelockController, votes, and quorum.',
		fileName: 'MyGovernor.sol',
		source: `${PRAGMA}import {Governor} from "@openzeppelin/contracts/governance/Governor.sol";
import {GovernorSettings} from "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import {GovernorCountingSimple} from "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import {GovernorVotes, IVotes} from "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import {GovernorVotesQuorumFraction} from "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import {GovernorTimelockControl, TimelockController} from "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";

/// @title MyGovernor
/// @notice OZ Governor with timelock, simple counting, and fractional quorum.
contract MyGovernor is
    Governor,
    GovernorSettings,
    GovernorCountingSimple,
    GovernorVotes,
    GovernorVotesQuorumFraction,
    GovernorTimelockControl
{
    constructor(IVotes _token, TimelockController _timelock)
        Governor("MyGovernor")
        GovernorSettings(7200 /* 1 day */, 50400 /* 1 week */, 0)
        GovernorVotes(_token)
        GovernorVotesQuorumFraction(4) // 4% quorum
        GovernorTimelockControl(_timelock)
    {}

    function votingDelay() public view override(Governor, GovernorSettings) returns (uint256) { return super.votingDelay(); }
    function votingPeriod() public view override(Governor, GovernorSettings) returns (uint256) { return super.votingPeriod(); }
    function quorum(uint256 blockNumber) public view override(Governor, GovernorVotesQuorumFraction) returns (uint256) { return super.quorum(blockNumber); }
    function proposalThreshold() public view override(Governor, GovernorSettings) returns (uint256) { return super.proposalThreshold(); }
    function state(uint256 proposalId) public view override(Governor, GovernorTimelockControl) returns (ProposalState) { return super.state(proposalId); }
    function proposalNeedsQueuing(uint256 proposalId) public view override(Governor, GovernorTimelockControl) returns (bool) { return super.proposalNeedsQueuing(proposalId); }
    function _queueOperations(uint256 proposalId, address[] memory targets, uint256[] memory values, bytes[] memory calldatas, bytes32 descriptionHash) internal override(Governor, GovernorTimelockControl) returns (uint48) { return super._queueOperations(proposalId, targets, values, calldatas, descriptionHash); }
    function _executeOperations(uint256 proposalId, address[] memory targets, uint256[] memory values, bytes[] memory calldatas, bytes32 descriptionHash) internal override(Governor, GovernorTimelockControl) { super._executeOperations(proposalId, targets, values, calldatas, descriptionHash); }
    function _cancel(address[] memory targets, uint256[] memory values, bytes[] memory calldatas, bytes32 descriptionHash) internal override(Governor, GovernorTimelockControl) returns (uint256) { return super._cancel(targets, values, calldatas, descriptionHash); }
    function _executor() internal view override(Governor, GovernorTimelockControl) returns (address) { return super._executor(); }
}
`,
	},

	// ── Foundry Test ──────────────────────────────────────────────────────────
	{
		id: 'foundry-test',
		name: 'Foundry Test Suite',
		category: 'Testing',
		description: 'Foundry test file with setUp, unit tests, fuzz test, and invariant test.',
		fileName: 'MyContract.t.sol',
		source: `${PRAGMA}import {Test, console} from "forge-std/Test.sol";
import {MyContract} from "../src/MyContract.sol";

/// @title MyContractTest
/// @notice Foundry test suite for MyContract.
contract MyContractTest is Test {
    MyContract public target;
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");

    function setUp() public {
        target = new MyContract();
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
    }

    // ── Unit Tests ────────────────────────────────────────────────────────────

    function test_InitialState() public view {
        // TODO: assert initial contract state
    }

    function test_RevertWhen_UnauthorizedCall() public {
        vm.expectRevert();
        vm.prank(alice);
        // TODO: call a restricted function
    }

    // ── Fuzz Tests ────────────────────────────────────────────────────────────

    function testFuzz_SomeProperty(uint256 amount) public {
        amount = bound(amount, 1, type(uint128).max);
        // TODO: fuzz test property
    }

    // ── Invariant Tests ───────────────────────────────────────────────────────
    // For stateful fuzz (invariant tests) use:
    // forge test --match-contract MyContractInvariant
}
`,
	},

	// ── Deploy Script ─────────────────────────────────────────────────────────
	{
		id: 'foundry-deploy',
		name: 'Foundry Deploy Script',
		category: 'Testing',
		description: 'Foundry deploy script with vm.startBroadcast() and logging.',
		fileName: 'Deploy.s.sol',
		source: `${PRAGMA}import {Script, console} from "forge-std/Script.sol";
import {MyContract} from "../src/MyContract.sol";

/// @title DeployMyContract
/// @notice Run with: forge script script/Deploy.s.sol --broadcast --rpc-url $RPC_URL
contract DeployMyContract is Script {
    function run() public returns (MyContract deployed) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        deployed = new MyContract();

        vm.stopBroadcast();
        console.log("MyContract deployed at:", address(deployed));
    }
}
`,
	},
];

export function getTemplatesByCategory(): Map<string, ContractTemplate[]> {
	const map = new Map<string, ContractTemplate[]>();
	for (const t of TEMPLATES) {
		const list = map.get(t.category) ?? [];
		list.push(t);
		map.set(t.category, list);
	}
	return map;
}
