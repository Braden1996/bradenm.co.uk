#!/bin/zsh

# Shared shell helpers for the isolated TouchDesigner automation entry points.

td_validate_environment() {
  if [[ ! -x ${td_app} ]]; then
    print -u2 "TouchDesigner was not found at ${td_app}."
    return 2
  fi
  if [[ ! -f ${bootstrap_toe} ]]; then
    print -u2 "The committed automation bootstrap is missing: ${bootstrap_toe}"
    return 2
  fi
  if [[ ! -f ${callback} ]]; then
    print -u2 "The TouchDesigner callback is missing: ${callback}"
    return 2
  fi
  if [[ ${run_dir} != /private/tmp/* || ${run_dir} == /private/tmp ]]; then
    print -u2 "CODEX_TD_RUN_DIR must be a named child of /private/tmp: ${run_dir}"
    return 2
  fi
  if [[ ${timeout_seconds} != <-> || ${timeout_seconds} -le 0 ]]; then
    print -u2 "The TouchDesigner timeout must be a positive whole number."
    return 2
  fi
}

td_prepare_run_dir() {
  mkdir -p ${run_dir}
  # Removing the entire validated directory prevents stale status or frame files from making a
  # later run look successful. The safety check above limits the target to /private/tmp/<name>.
  rm -rf ${run_dir}
  mkdir -p ${run_dir}
}

td_start() {
  CODEX_TD_CALLBACK=${callback} \
  CODEX_TD_RUN_DIR=${run_dir} \
  CODEX_TD_REPO_ROOT=${repo_root} \
  CODEX_TD_START_FRAME=${start_frame:-0} \
  TOUCH_ALWAYS_START=1 \
  TOUCH_MAX_PROCESSES=10 \
  TOUCH_NO_UPDATE_CHECK=1 \
  ${td_app} ${bootstrap_toe} >${run_dir}/touchdesigner.log 2>&1 &
  td_pid=$!
  caffeinate -i -w ${td_pid} >/dev/null 2>&1 &
  caffeinate_pid=$!
}

td_cleanup() {
  if [[ -n ${td_pid:-} ]] && kill -0 ${td_pid} 2>/dev/null; then
    kill -TERM ${td_pid} 2>/dev/null || true
  fi
  if [[ -n ${caffeinate_pid:-} ]] && kill -0 ${caffeinate_pid} 2>/dev/null; then
    kill -TERM ${caffeinate_pid} 2>/dev/null || true
  fi
}

td_wait_for_status() {
  local last_progress=${SECONDS}
  local status_signature=""
  local current_signature=""
  while [[ $((SECONDS - last_progress)) -lt ${timeout_seconds} ]]; do
    if [[ -f ${status_file} ]]; then
      current_signature=$(stat -f '%m:%z' ${status_file} 2>/dev/null || true)
      if [[ ${current_signature} != ${status_signature} ]]; then
        status_signature=${current_signature}
        last_progress=${SECONDS}
      fi
    fi
    if [[ -f ${status_file} ]] && \
      grep -Eq '"result"[[:space:]]*:[[:space:]]*"(success|failure)"' ${status_file}; then
      break
    fi
    if ! kill -0 ${td_pid} 2>/dev/null; then
      break
    fi
    sleep 1
  done

  if [[ ! -f ${status_file} ]]; then
    if [[ -f ${run_dir}/bootstrap-error.txt ]]; then
      print -u2 "The bootstrap callback failed:"
      cat ${run_dir}/bootstrap-error.txt >&2
    else
      print -u2 "TouchDesigner exited without writing status. Log: ${run_dir}/touchdesigner.log"
    fi
    return 1
  fi

  cat ${status_file}
  if kill -0 ${td_pid} 2>/dev/null && \
    [[ $((SECONDS - last_progress)) -ge ${timeout_seconds} ]]; then
    print -u2 \
      "TouchDesigner made no status progress for ${timeout_seconds}s. Log: ${run_dir}/touchdesigner.log"
    return 1
  fi

  if ! grep -Eq '"result"[[:space:]]*:[[:space:]]*"success"' ${status_file}; then
    print -u2 "TouchDesigner automation failed. Log: ${run_dir}/touchdesigner.log"
    return 1
  fi
}

td_finish() {
  wait ${td_pid} 2>/dev/null || true
  td_pid=
  wait ${caffeinate_pid} 2>/dev/null || true
  caffeinate_pid=
  trap - EXIT INT TERM
}
