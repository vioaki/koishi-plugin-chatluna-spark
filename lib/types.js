"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskConditionType = exports.CancelEvent = exports.SparkTaskStatus = exports.SparkTaskType = void 0;
var SparkTaskType;
(function (SparkTaskType) {
    SparkTaskType["REMINDER"] = "reminder";
    SparkTaskType["FOLLOW_UP"] = "follow-up";
    SparkTaskType["MEMO"] = "memo";
    SparkTaskType["SCHEDULED"] = "scheduled";
    SparkTaskType["FESTIVAL"] = "festival"; // 节日问候
})(SparkTaskType || (exports.SparkTaskType = SparkTaskType = {}));
var SparkTaskStatus;
(function (SparkTaskStatus) {
    SparkTaskStatus["PENDING"] = "pending";
    SparkTaskStatus["EXECUTED"] = "executed";
    SparkTaskStatus["CANCELLED"] = "cancelled";
    SparkTaskStatus["FAILED"] = "failed";
})(SparkTaskStatus || (exports.SparkTaskStatus = SparkTaskStatus = {}));
var CancelEvent;
(function (CancelEvent) {
    CancelEvent["USER_MESSAGE"] = "user-message";
    CancelEvent["TASK_COMPLETED"] = "task-completed";
    CancelEvent["MANUAL"] = "manual";
})(CancelEvent || (exports.CancelEvent = CancelEvent = {}));
var TaskConditionType;
(function (TaskConditionType) {
    TaskConditionType["USER_IDLE"] = "user-idle";
    TaskConditionType["TIME_RANGE"] = "time-range";
    TaskConditionType["CUSTOM"] = "custom";
})(TaskConditionType || (exports.TaskConditionType = TaskConditionType = {}));
