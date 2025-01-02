# simple scrip to calculate hours usage stats (sum across all days)

BEGIN {
    OFS = " ";                   # Output field separator
    utc_offset_seconds = 5 * 3600 + 30 * 60; # Offset in seconds for IST (+5:30)
    PROCINFO["sorted_in"] = "@ind_str_asc" ; # set sorting order for arrays
}
{
    # Parse ISO datetime and MB value
    split($2, datetime, "T");
    split(datetime[1], date_parts, "-");
    split(datetime[2], time_parts, ":");

    year = date_parts[1];
    month = date_parts[2];
    day = date_parts[3];

    hour = time_parts[1];
    minute = time_parts[2];
    second = time_parts[3];

    mb = int($20/1024);

    # Convert datetime to epoch seconds
    utc_seconds = mktime(year " " month " " day " " hour " " minute " " second);

    # Adjust for IST
    ist_seconds = utc_seconds + utc_offset_seconds;

    # Extract IST hour
    ist_hour = strftime("%H", ist_seconds);

    #print year, month, day, hour, minute, second, ist_hour, mb
    # Special handling for the first line
    if (NR == 1) {
        last_mb = mb;
        last_hour = ist_hour;
        next;
    }

    # Calculate the MB transferred during this interval
    transfer = mb - last_mb;

    # Accumulate transfer in the hash table for the current IST hour
    hourly_transfer[ist_hour] += transfer;

    # Update the last seen MB and hour
    last_mb = mb;
    last_hour = ist_hour;
}
END {
    # Output the transfer data for each hour
    for (hour in hourly_transfer) {
        print hour, hourly_transfer[hour];
    }
}
