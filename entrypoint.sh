#!/bin/bash

set -e
if [ "$1" = 'start' ]; then
  if [ $MODE = "production" ]; then
  yarn run build --release
  node ./build/server.js
    else
    yarn start
  fi
fi

exec "$@"

