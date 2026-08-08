// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Jejak onchain untuk setiap task AgentPay. Bukan escrow — tidak menyimpan dana.
contract AgentPay {
    enum Status { Open, InProgress, Approved, Rejected, Completed }

    struct Task {
        address poster;
        address worker;
        uint256 budget; // dalam unit terkecil USDC (6 decimals)
        Status status;
        bytes32 submissionHash;
    }

    event TaskCreated(uint64 indexed taskId, address indexed poster, uint256 budget);
    event TaskClaimed(uint64 indexed taskId, address indexed worker);
    event TaskPaid(
        uint64 indexed taskId,
        address indexed poster,
        address indexed worker,
        uint256 budget,
        bytes32 submissionHash
    );

    Task[] private _tasks;
    mapping(address => uint64[]) private _posted;

    uint64 public taskCount;

    function createTask(address poster, uint256 budget) external returns (uint64 id) {
        require(poster != address(0), "AgentPay: zero poster");
        require(budget > 0, "AgentPay: zero budget");
        id = taskCount++;
        _tasks.push(Task(poster, address(0), budget, Status.Open, 0));
        _posted[poster].push(id);
        emit TaskCreated(id, poster, budget);
    }

    function claimTask(uint64 id, address worker) external {
        Task storage t = _tasks[id];
        require(t.status == Status.Open, "AgentPay: not open");
        require(worker != address(0), "AgentPay: zero worker");
        t.worker = worker;
        t.status = Status.InProgress;
        emit TaskClaimed(id, worker);
    }

    function approveTask(uint64 id) external {
        Task storage t = _tasks[id];
        require(t.status == Status.InProgress, "AgentPay: not in progress");
        t.status = Status.Approved;
    }

    function rejectTask(uint64 id) external {
        Task storage t = _tasks[id];
        require(t.status == Status.InProgress, "AgentPay: not in progress");
        t.status = Status.Rejected;
    }

    function recordPayment(uint64 id, bytes32 submissionHash) external {
        Task storage t = _tasks[id];
        require(t.status == Status.Approved, "AgentPay: not approved");
        require(t.worker != address(0), "AgentPay: no worker");
        t.submissionHash = submissionHash;
        t.status = Status.Completed;
        emit TaskPaid(id, t.poster, t.worker, t.budget, submissionHash);
    }

    function taskOf(uint64 id) external view returns (Task memory) {
        return _tasks[id];
    }

    function allTasks() external view returns (Task[] memory) {
        return _tasks;
    }

    function postedBy(address poster) external view returns (uint64[] memory) {
        return _posted[poster];
    }
}
