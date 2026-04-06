use scripting additions

on run argv
	if (count of argv) < 2 then
		error "Usage: convert-mac.applescript <inputPath> <outputDir>"
	end if
	
	set inputPath to item 1 of argv
	set outputDir to item 2 of argv
	set slidesDir to outputDir & "/slides"
	
    -- LOGGING
    do shell script "echo 'Starting conversion...' >&2"
    do shell script "echo 'Input: " & inputPath & "' >&2"
    do shell script "echo 'Output: " & outputDir & "' >&2"
	
	-- Create slides directory? 
    -- PowerPoint might want to create it. Let's ensure parent exists, but maybe remove 'slides' if it exists.
    do shell script "mkdir -p " & quoted form of outputDir -- Ensure parent
    do shell script "rm -rf " & quoted form of slidesDir -- Remove slides dir if exists to let PPT create it?
    -- Actually, if we pass a folder path, PPT usually puts files INSIDE it.
    -- If we pass a file path, it makes a folder.
    -- Let's try ensuring it exists as a FOLDER.
	do shell script "mkdir -p " & quoted form of slidesDir
	
	tell application "Microsoft PowerPoint"
		launch -- Start without activating/stealing focus
		
        -- CHECK IF ALREADY OPEN
        set pres to missing value
        try
            repeat with p in presentations
                -- Check full name (path) or name (filename)
                -- full name is safer but might vary in format (HFS vs POSIX)
                -- Let's try to match loosely or convert inputPath to HFS
                if full name of p contains inputPath then
                    set pres to p
                    exit repeat
                end if
            end repeat
        end try
        
        if pres is missing value then
             -- Open the presentation
             open (POSIX file inputPath)
             
             -- Try to hide the window
            try
                set window state of active window to minimized
            end try
             
             set pres to active presentation
        else
            -- It was already open, just use it
             do shell script "echo 'Presentation already open, using existing session.' >&2"
        end if

		
		-- Get slide count
		set slideCount to count of slides of pres
        do shell script "echo 'Slide Count: " & slideCount & "' >&2"
		
        -- Convert POSIX path to HFS path for PowerPoint
        -- PowerPoint often prefers HFS paths (colon separated)
        try
            set slidesHFS to (POSIX file slidesDir) as text
        on error
            -- Fallback
            set slidesHFS to slidesDir 
        end try
        
        -- Ensure trailing colon for directory specifier?
        -- If it's a folder, yes.
        if slidesHFS does not end with ":" then
            set slidesHFS to slidesHFS & ":"
        end if
        
        do shell script "echo 'HFS Path: " & slidesHFS & "' >&2"
        
        -- We are forcing Individual Slide Save to avoid Mac PPT bulk export naming bugs
        -- where rearranged slides get the wrong names.
        
        -- Get a unique timestamp to append to filenames so React knows they are new
        set ts to (time of (current date)) as string
        
        repeat with i from 1 to slideCount
            set slideName to "Slide_" & i & "_" & ts & ".png"
            set slidePathPosix to slidesDir & "/" & slideName
            set slidePathHFS to slidesHFS & slideName as text
            
            set slideSaved to false
            
            -- Method 3: Individual Slide Save
            try
                 tell slide i of pres
                     save in slidePathHFS as save as PNG
                 end tell
                 set slideSaved to true
            on error
                 -- Method 4: Clipboard Fallback (Last Resort)
                 try
                    tell slide i of pres
                        copy object
                    end tell
                    delay 0.2
                    
                    set pngData to the clipboard as «class PNGf»
                    set fRef to open for access (POSIX file slidePathPosix) with write permission
                    set eof fRef to 0
                    write pngData to fRef
                    close access fRef
                    set slideSaved to true
                 on error
                    try
                        close access (POSIX file slidePathPosix)
                    end try
                 end try
            end try
        end repeat
		
		-- Collect Manifest Data
		set slidesData to {}
		
		repeat with i from 1 to slideCount
            set slideNum to i
            
            -- Determine Image Filename
            set bestName to "Slide_" & slideNum & "_" & ts & ".png"
            set imageRelPath to ""
            
            -- Check for existence using shell
            if (do shell script "[ -f " & quoted form of (slidesDir & "/" & bestName) & " ] && echo 'yes' || echo 'no'") is "yes" then
                set imageRelPath to "slides/" & bestName
            else
                -- Try fuzzy match
                 try
                    set foundFile to do shell script "ls " & quoted form of slidesDir & " | grep -i '^Slide_" & slideNum & "_.*\\.png$'"
                    -- Take first line if multiple
                    set foundFile to paragraph 1 of foundFile
                    set imageRelPath to "slides/" & foundFile
                 on error
                    set imageRelPath to ""
                 end try
            end if
            
			-- Extract Notes
			set notesText to ""
			try
				tell slide i of pres
					tell notes page
						set shapeCount to count of shapes
						if shapeCount > 1 then
							set notesText to content of text range of text frame of shape 2
						end if
					end tell
				end tell
			end try
			
			-- ESCAPE DELIMITERS IN NOTES
            set safeNotes to my cleanNotes(notesText)
            
			set dataItem to (slideNum as text) & "|||" & imageRelPath & "|||" & safeNotes
			copy dataItem to end of slidesData
		end repeat
		
		-- DO NOT CLOSE - KEEP OPEN FOR USER
		-- close pres saving no
		
	end tell
	
	-- Write to file using Perl to construct JSON
    set manifestPath to outputDir & "/manifest.json"
    set inputData to my joinList(slidesData, linefeed)
    set tempPath to outputDir & "/temp_data.txt"
    
    try
        set fileRef to open for access (POSIX file tempPath) with write permission
        set eof fileRef to 0
        write inputData to fileRef as «class utf8»
        close access fileRef
    on error
        -- Fallback to shell write
        do shell script "echo " & quoted form of inputData & " > " & quoted form of tempPath
    end try
    
    -- Exec Perl
    set perlScript to "use JSON::PP; use strict; use warnings; 
    open(my $fh, '<:encoding(UTF-8)', $ARGV[0]) or die $!; 
    my @slides; 
    while(<$fh>) { 
        chomp; 
        next unless /\\|\\|\\|/; 
        my ($idx, $img, $notes) = split(/\\|\\|\\|/, $_, 3); 
        next unless defined $idx && $idx =~ /^\\d+$/; 
        $notes = '' unless defined $notes;
        push @slides, { index => $idx + 0, image => $img, notes => $notes }; 
    } 
    close($fh); 
    open(my $out, '>:encoding(UTF-8)', $ARGV[1]) or die $!; 
    print $out encode_json(\\@slides); 
    close($out);"
    
    do shell script "perl -e " & quoted form of perlScript & " -- " & quoted form of tempPath & " " & quoted form of manifestPath

    -- Cleanup temp file
    try
        do shell script "rm " & quoted form of tempPath
    end try
    
    -- Log directory contents
    do shell script "ls -R " & quoted form of outputDir & " >&2"
	
	return manifestPath
end run

-- Handlers

on cleanNotes(str)
    if str is missing value then return ""
    set str to str as text
    set text item delimiters to "|||"
    set itemsList to text items of str
    set text item delimiters to "   " 
    set str to itemsList as text
    
    set text item delimiters to return
    set itemsList to text items of str
    set text item delimiters to "\\n"
    set str to itemsList as text
    
    set text item delimiters to linefeed
    set itemsList to text items of str
    set text item delimiters to "\\n"
    set str to itemsList as text
    
    -- Replace smart quotes and dashes to prevent encoding issues
    set text item delimiters to "’"
    set itemsList to text items of str
    set text item delimiters to "'"
    set str to itemsList as text
    
    set text item delimiters to "‘"
    set itemsList to text items of str
    set text item delimiters to "'"
    set str to itemsList as text
    
    set text item delimiters to "“"
    set itemsList to text items of str
    set text item delimiters to "\""
    set str to itemsList as text
    
    set text item delimiters to "”"
    set itemsList to text items of str
    set text item delimiters to "\""
    set str to itemsList as text
    
    set text item delimiters to "–" -- En dash
    set itemsList to text items of str
    set text item delimiters to "-"
    set str to itemsList as text
    
    set text item delimiters to "—" -- Em dash
    set itemsList to text items of str
    set text item delimiters to "--"
    set str to itemsList as text

    return str
end cleanNotes

on joinList(theList, delimiter)
	set oldDelimiters to AppleScript's text item delimiters
	set AppleScript's text item delimiters to delimiter
	set theString to theList as string
	set AppleScript's text item delimiters to oldDelimiters
	return theString
end joinList
