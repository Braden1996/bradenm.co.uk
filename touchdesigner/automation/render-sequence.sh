#!/bin/zsh
set -eu

script_dir=${0:A:h}
td_root=${script_dir:h}
repo_root=${td_root:h}
td_app=/Applications/TouchDesigner.app/Contents/MacOS/TouchDesigner
bootstrap_toe=${script_dir}/bootstrap.toe
callback=${script_dir}/render-sequence.py
run_dir=${CODEX_TD_RUN_DIR:-/private/tmp/braden-touchdesigner-sequence}
timeout_seconds=${CODEX_TD_TIMEOUT_SECONDS:-240}
start_frame=${CODEX_TD_START_FRAME:-0}
run_dir=${run_dir:A}
status_file=${run_dir}/sequence-status.json

source ${script_dir}/common.sh
td_validate_environment
if [[ ${start_frame} != <-> || ${start_frame} -lt 0 || ${start_frame} -ge 48 ]]; then
  print -u2 "CODEX_TD_START_FRAME must be a whole number from 0 through 47."
  exit 2
fi

if [[ ${start_frame} -eq 0 ]]; then
  td_prepare_run_dir
else
  mkdir -p ${run_dir}/frames
  for ((index = 1; index <= start_frame; index++)); do
    printf -v frame_name "frame-%03d.png" ${index}
    if [[ ! -s ${run_dir}/frames/${frame_name} ]]; then
      print -u2 "Cannot resume: the completed prefix is missing ${frame_name}."
      exit 2
    fi
  done
  for ((index = start_frame + 1; index <= 48; index++)); do
    printf -v frame_name "frame-%03d.png" ${index}
    rm -f ${run_dir}/frames/${frame_name}
  done
  rm -f ${status_file} ${run_dir}/bootstrap-error.txt
fi
td_start
trap td_cleanup EXIT INT TERM
td_wait_for_status
td_finish
print "Frames: ${run_dir}/frames"
