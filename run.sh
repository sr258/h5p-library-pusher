#!/bin/bash

while true
do
  npm start
  if [[ $? -ne 0 ]]; then
    exit 1
  fi
  sleep 12h
done