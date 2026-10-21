/**
 * Robot runtime — public entry point.
 *
 * Layering (each layer depends only on the ones above it):
 *
 *   types.ts          shared data shapes of the runtime
 *   constants.ts      paths and tables shared by the game and the shell
 *   RobotDeviceBus.ts the robot's hardware, seen from a program
 *   RobotKernel.ts    process table, scheduler and control verbs
 *
 * Nothing here imports the DOM or the game windows, so the runtime can be
 * unit-tested in plain Node, like the RASM language core.
 */
export * from './types'
export * from './constants'
export * from './RobotDeviceBus'
export * from './RobotKernel'
