// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AgentPay} from "../src/AgentPay.sol";
import {Test, console2} from "forge-std/Test.sol";

contract AgentPayTest is Test {
    AgentPay ap;
    address poster = address(0xA1);
    address worker = address(0xB2);

    function setUp() public {
        ap = new AgentPay();
    }

    function testCreateSetsState() public {
        uint64 id = ap.createTask(poster, 5e6);
        assertEq(ap.taskCount(), 1);
        AgentPay.Task memory t = ap.taskOf(id);
        assertEq(t.poster, poster);
        assertEq(t.budget, 5e6);
        assertEq(uint(t.status), uint(AgentPay.Status.Open));
    }

    function testCreateEmitsTaskCreated() public {
        vm.expectEmit(true, true, false, true, address(ap));
        emit AgentPay.TaskCreated(0, poster, 5e6);
        ap.createTask(poster, 5e6);
    }

    function testRevertZeroBudget() public {
        vm.expectRevert("AgentPay: zero budget");
        ap.createTask(poster, 0);
    }

    function testClaimThenApproveThenPay() public {
        uint64 id = ap.createTask(poster, 5e6);
        ap.claimTask(id, worker);
        assertEq(uint(ap.taskOf(id).status), uint(AgentPay.Status.InProgress));

        ap.approveTask(id);
        assertEq(uint(ap.taskOf(id).status), uint(AgentPay.Status.Approved));

        bytes32 hash = keccak256("result");
        vm.expectEmit(true, true, true, false, address(ap));
        emit AgentPay.TaskPaid(id, poster, worker, 5e6, hash);
        ap.recordPayment(id, hash);

        AgentPay.Task memory t = ap.taskOf(id);
        assertEq(uint(t.status), uint(AgentPay.Status.Completed));
        assertEq(t.submissionHash, hash);
    }

    function testRevertPayWithoutApprove() public {
        uint64 id = ap.createTask(poster, 5e6);
        ap.claimTask(id, worker);
        vm.expectRevert("AgentPay: not approved");
        ap.recordPayment(id, keccak256("x"));
    }

    function testRevertDoubleClaim() public {
        uint64 id = ap.createTask(poster, 5e6);
        ap.claimTask(id, worker);
        vm.expectRevert("AgentPay: not open");
        ap.claimTask(id, address(0xC3));
    }

    function testPostedByTracksPoster() public {
        ap.createTask(poster, 1e6);
        ap.createTask(poster, 2e6);
        assertEq(ap.postedBy(poster).length, 2);
    }
}