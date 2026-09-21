use scripting additions

on run argv
	try
		if (count of argv) < 2 then
			error "Usage: export-slide-images.applescript <inputPath> <outputDir> [slideNumber]"
		end if

		set inputPath to item 1 of argv
		set outputDir to item 2 of argv
		set slidesDir to outputDir & "/slides"
		set targetSlideNumber to missing value
		if (count of argv) > 2 then
			set targetSlideNumber to my parseSlideNumber(item 3 of argv)
		end if

		set shouldRebuildSlidesDir to (targetSlideNumber is missing value)
		my prepareOutputDirectory(outputDir, slidesDir, shouldRebuildSlidesDir)
		set exportToken to (do shell script "uuidgen")

		tell application "Microsoft PowerPoint"
			set pres to my locateOrOpenPresentation(inputPath)
			activate

			set slideCount to count of slides of pres
			if targetSlideNumber is not missing value then
				if targetSlideNumber > slideCount then
					error "Slide number " & targetSlideNumber & " is out of range. Presentation has " & slideCount & " slide(s)."
				end if

				set slidesHFS to my toHfsDirectoryPath(slidesDir)
				set imageRelPath to my exportSlideToPng(pres, targetSlideNumber, slidesDir, slidesHFS, exportToken)
				if imageRelPath is "" then
					error "Could not export image for slide " & targetSlideNumber
				end if
				return my jsonSuccess("image", imageRelPath)
			end if

			set slidesHFS to my toHfsDirectoryPath(slidesDir)
			set imageData to {}
			repeat with i from 1 to slideCount
				set imageRelPath to my exportSlideToPng(pres, i, slidesDir, slidesHFS, exportToken)
				set dataItem to (i as text) & "|||" & imageRelPath
				copy dataItem to end of imageData
			end repeat
		end tell

		set manifestPath to my writeImageManifest(outputDir, imageData)
		return my jsonSuccess("manifestPath", manifestPath)
	on error errMsg
		return my jsonError(errMsg)
	end try
end run

on parseSlideNumber(slideNumberText)
	try
		set slideNumber to slideNumberText as integer
	on error
		error "Slide number must be a 1-based integer."
	end try

	if slideNumber < 1 then
		error "Slide number must be a 1-based integer."
	end if

	return slideNumber
end parseSlideNumber

on locateOrOpenPresentation(inputPath)
	tell application "Microsoft PowerPoint"
		launch -- Start without activating/stealing focus

		set pres to missing value
		try
			repeat with p in presentations
				if full name of p contains inputPath then
					set pres to p
					exit repeat
				end if
			end repeat
		end try

		if pres is missing value then
			open (POSIX file inputPath)
			set pres to active presentation
		end if

		return pres
	end tell
end locateOrOpenPresentation

on prepareOutputDirectory(outputDir, slidesDir, rebuildSlidesDir)
	do shell script "mkdir -p " & quoted form of outputDir
	if rebuildSlidesDir then
		do shell script "rm -rf " & quoted form of slidesDir
	end if
	do shell script "mkdir -p " & quoted form of slidesDir
end prepareOutputDirectory

on toHfsDirectoryPath(slidesDir)
	try
		set slidesHFS to (POSIX file slidesDir) as text
	on error
		set slidesHFS to slidesDir
	end try

	if slidesHFS does not end with ":" then
		set slidesHFS to slidesHFS & ":"
	end if

	return slidesHFS
end toHfsDirectoryPath

on exportSlideToPng(pres, slideNumber, slidesDir, slidesHFS, exportToken)
	set slideName to "Slide_" & slideNumber & "_" & exportToken & ".png"
	set slidePathPosix to slidesDir & "/" & slideName
	set slidePathHFS to slidesHFS & slideName as text

	try
		tell application "Microsoft PowerPoint"
			tell slide slideNumber of pres
				save in slidePathHFS as save as PNG
			end tell
		end tell
	end try

	if not my fileExists(slidePathPosix) then
		try
			my exportSlideWithClipboard(pres, slideNumber, slidePathPosix)
		end try
	end if

	if my fileExists(slidePathPosix) then
		return "slides/" & slideName
	end if

	return ""
end exportSlideToPng

on exportSlideWithClipboard(pres, slideNumber, slidePathPosix)
	set fRef to missing value
	try
		tell application "Microsoft PowerPoint"
			tell slide slideNumber of pres
				copy object
			end tell
		end tell
		delay 0.2

		set pngData to the clipboard as «class PNGf»
		set fRef to open for access (POSIX file slidePathPosix) with write permission
		set eof fRef to 0
		write pngData to fRef
		close access fRef
	on error errMsg
		if fRef is not missing value then
			try
				close access fRef
			end try
		end if
		error errMsg
	end try
end exportSlideWithClipboard

on fileExists(posixPath)
	return (do shell script "[ -f " & quoted form of posixPath & " ] && echo 'yes' || echo 'no'") is "yes"
end fileExists

on writeImageManifest(outputDir, imageData)
	set manifestPath to outputDir & "/images.json"
	set inputData to my joinList(imageData, linefeed)
	set tempPath to outputDir & "/temp_images.txt"

	try
		set fileRef to open for access (POSIX file tempPath) with write permission
		set eof fileRef to 0
		write inputData to fileRef as «class utf8»
		close access fileRef
	on error
		do shell script "echo " & quoted form of inputData & " > " & quoted form of tempPath
	end try

	set perlScript to "use JSON::PP; use strict; use warnings; " & ¬
		"open(my $fh, '<:encoding(UTF-8)', $ARGV[0]) or die $!; " & ¬
		"my @slides; " & ¬
		"while(<$fh>) { chomp; next unless /\\|\\|\\|/; my ($slideNum, $img) = split(/\\|\\|\\|/, $_, 2); next unless defined $slideNum && $slideNum =~ /^\\d+$/; $img = '' unless defined $img; push @slides, { slideNumber => $slideNum + 0, image => $img }; } " & ¬
		"close($fh); " & ¬
		"open(my $out, '>:encoding(UTF-8)', $ARGV[1]) or die $!; " & ¬
		"print $out encode_json(\\@slides); " & ¬
		"close($out);"

	do shell script "perl -e " & quoted form of perlScript & " -- " & quoted form of tempPath & " " & quoted form of manifestPath

	try
		do shell script "rm " & quoted form of tempPath
	end try

	return manifestPath
end writeImageManifest

on joinList(theList, theDelimiter)
	set AppleScript's text item delimiters to theDelimiter
	set joinedText to theList as text
	set AppleScript's text item delimiters to ""
	return joinedText
end joinList

on jsonSuccess(keyName, valueText)
	return "{\"success\":true,\"data\":{\"" & keyName & "\":\"" & my escapeJson(valueText) & "\"}}"
end jsonSuccess

on jsonError(messageText)
	return "{\"success\":false,\"message\":\"" & my escapeJson(messageText) & "\"}"
end jsonError

on escapeJson(valueText)
	set escapedText to valueText as text
	set escapedText to my replaceText(escapedText, "\\", "\\\\")
	set escapedText to my replaceText(escapedText, "\"", "\\\"")
	set escapedText to my replaceText(escapedText, return & linefeed, "\\n")
	set escapedText to my replaceText(escapedText, return, "\\n")
	set escapedText to my replaceText(escapedText, linefeed, "\\n")
	return escapedText
end escapeJson

on replaceText(sourceText, findText, replaceWith)
	set oldDelimiters to AppleScript's text item delimiters
	set AppleScript's text item delimiters to findText
	set textItems to text items of sourceText
	set AppleScript's text item delimiters to replaceWith
	set replacedText to textItems as text
	set AppleScript's text item delimiters to oldDelimiters
	return replacedText
end replaceText
