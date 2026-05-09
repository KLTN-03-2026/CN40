/**
 * task-service.js
 * Facade that re-exports from task-crud-service.js and task-write-service.js.
 * Controllers import from here to get a single stable interface.
 */

const { listTasks, getTask, getFullTimeCategory, deleteTask } = require("./task-crud-service");
const { createTask, updateTask } = require("./task-write-service");

module.exports = { listTasks, getTask, getFullTimeCategory, deleteTask, createTask, updateTask };
