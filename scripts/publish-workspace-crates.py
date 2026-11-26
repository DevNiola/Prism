#!/usr/bin/env python3
"""Publish crates.io workspace packages in dependency order."""

import json
import os
import subprocess
from graphlib import TopologicalSorter


metadata = json.loads(subprocess.check_output(
    ["cargo", "metadata", "--no-deps", "--format-version", "1"], text=True
))
members = set(metadata["workspace_members"])
packages = {
    package["name"]: package for package in metadata["packages"]
    if package["id"] in members
    and (package["publish"] is None or "crates-io" in package["publish"])
}
dependencies = {
    name: sorted({
        dependency["name"] for dependency in package["dependencies"]
        if dependency.get("path") and dependency["name"] in packages
        and (dependency["kind"] != "dev" or dependency["req"] != "*")
    })
    for name, package in sorted(packages.items())
}
order = list(TopologicalSorter(dependencies).static_order())
if not order:
    raise SystemExit("No publishable workspace crates")

published = []
for name in order:
    version = packages[name]["version"]
    label = f"{name}@{version}"
    publish = subprocess.run(["cargo", "publish", "--all-features", "-p", name])
    if publish.returncode == 0:
        published.append(label)

    verify = subprocess.run(["bash", "scripts/verify-crate-published.sh", name])
    if publish.returncode or verify.returncode:
        with open(os.environ["GITHUB_OUTPUT"], "a") as output:
            print(f"published={', '.join(published)}", file=output)
            print(f"failed={label}", file=output)
        raise SystemExit(f"Publication or registry verification failed for {label}")
