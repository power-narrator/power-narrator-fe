on run {previousAppPath}
    tell application "Microsoft PowerPoint" to set powerPointInFront to frontmost
    if powerPointInFront then tell application previousAppPath to activate
end run
