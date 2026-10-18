//! Native commands added from roadmap milestone 7 on, grouped by area (7.8).
//! Commands stay thin: they validate arguments, call one storage method or pure
//! function inside `with_storage`, and turn failures into plain sentences. The
//! older commands remain in `lib.rs`.
pub mod confidence;
pub mod drills;
pub mod engagement;
pub mod insights;
pub mod learning;
