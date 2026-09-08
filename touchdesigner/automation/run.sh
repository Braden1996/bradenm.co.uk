#!/bin/zsh
set -eu

script_dir=${0:A:h}
td_root=${script_dir:h}
repo_root=${td_root:h}
td_app=/Applications/TouchDesigner.app/Contents/MacOS/TouchDesigner
bootstrap_toe=${script_dir}/bootstrap.toe
callback=${script_dir}/bootstrap.py
run_dir=${CODEX_TD_RUN_DIR:-/private/tmp/braden-touchdesigner-run}
timeout_seconds=${CODEX_TD_TIMEOUT_SECONDS:-90}
run_dir=${run_dir:A}
status_file=${run_dir}/status.json

source ${script_dir}/common.sh
td_validate_environment
td_prepare_run_dir
td_start
trap td_cleanup EXIT INT TERM
td_wait_for_status
td_finish
print "Preview: ${run_dir}/preview.png"
print "Project copy: ${run_dir}/about-portrait.generated.toe"
