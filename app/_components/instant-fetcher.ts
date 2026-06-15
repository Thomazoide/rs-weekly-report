const url = "https://ingreso.gpssegurtrack.net/reports/update?generate=1"

const devices = {
    101: "VJYS-65",
    100: "VJYT-17",
    121: "VJZB-91",
    103: "VJZJ-41",
    102: "VKWV-52",
    104: "VHTH-33",
    105: "VHTJ-23",
    107: "VHTJ-24",
    108: "VHTJ-25",
    109: "VHJT-26",
    110: "VHTJ-29",
    111: "VHTJ-30",
    112: "VHTJ-31",
    
}

const fetchConfig = {
  "headers": {
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "accept-language": "en-US,en;q=0.9,es-419;q=0.8,es;q=0.7,es-ES;q=0.6,en-GB;q=0.5,pl;q=0.4,es-CL;q=0.3,pt;q=0.2",
    "cache-control": "max-age=0",
    "content-type": "application/x-www-form-urlencoded",
    "sec-ch-ua": "\"Microsoft Edge\";v=\"149\", \"Chromium\";v=\"149\", \"Not)A;Brand\";v=\"24\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "same-origin",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
    "cookie": "remember_web_59ba36addc2b2f9401580f014c7f58ea4e30989d=eyJpdiI6InNuaHZuTTFVUDBUTzA5RFJyWTF0U3c9PSIsInZhbHVlIjoiRXlVcnJxRHlxVFU4UUxxN1EwZEZGWEV6N3o0KzVudDVwMExyV1QyZHFIckp2dm13cTNWUnVJNFNBNXBaczVleTZsclJqaGhRUGh4eTU0Rm8yRklJcHc5WmtEeGNvYTVsTHBrVzFyVndJWE0yNHFIQjQxeDlMb3ZCMTNSQjVadGFTSkgvYUM1N051aDc1cHp2NmtrU0dMK2lLbmhvMlhkSkdxWnNBNTlxRTJjMmdJNi81VnErdjBPUS84N1FFdFVPaXZJMXRDb3pLeEN1cmRmOThTdGszSTkyNUNsdE8rUndaNEl1dnM1MHBOcz0iLCJtYWMiOiJhYmNjYTdkZDMzYTlkZDMyMjQyN2Q0YzRhMWRiN2FmZjk4N2E2ODFjZGEyYTdkMWUyMWU3ZTYyYmZhMWM3ZWMzIiwidGFnIjoiIn0%3D; XSRF-TOKEN=eyJpdiI6IllxTVpUbzM2MklXY3hsdnhVMk0vSnc9PSIsInZhbHVlIjoiYks4ZU5IU0VkeXVLeFIwZU9WUS9LOFpMQmkyWGtWODNqc3pQY0tiblN1ekpWb0d3RndSRzJFVTVRUlg3Tm92Z0FiSlJIelpJYXpiUnhFQlowRFZVVmpVODJxKy8vTDNENmhjMThlTU9rc2R3VmZBV01qT0tvSnpRVERhVjA4MkIiLCJtYWMiOiIxYThlZjIyOTAwZmZiNmU4NjliZWQ1Y2IwN2QyNmE0ZGEyYTRhMjYyNGRmMTdmN2IzODBmMzQyNDMwZDJkYzNiIiwidGFnIjoiIn0%3D; laravel_session=eyJpdiI6InRUSlBWM3QyTWRVRmt6VXpSbmFHb2c9PSIsInZhbHVlIjoiNDV2VGgwWHp4RFhJQlhUeXFNN3dEVjZSNmxtODdVMkhtQ045anRPVEhleXBSeGhtak5mekx3bXVsOFNrRWwzdXU4a2dJcTdzUmJpV0hTcVFGMksyQWhOeTJIL0ZFbFZWbHdDZXRkemZ3Umk3a1ZEV3JONWdrc0hTMGtJcVZobzEiLCJtYWMiOiI0N2RhZmUzZDkyZjJmYzRkOTQ3Nzk3OGJlYjEwMDVjMTU5MjMyMjY0OWY4NDI1NjUyZjE0YmMwNTIwMTY3ODYxIiwidGFnIjoiIn0%3D",
    "Referer": "https://ingreso.gpssegurtrack.net/objects"
  },
  "body": "_token=kFH54nV2a4eeGlY3I3IfNfQ68aUGvgdZNNgwqcTY&id=&_method=POST&title=&type=1&format=json&period=1&reports_date_range=2026-06-01+00%3A00%3A00+-+2026-06-15+23%3A59%3A00&date_from=2026-06-01&from_time=00%3A00%3A00&date_to=2026-06-15&to_time=23%3A59%3A00&selected_devices%5B%5D=id%3Btrue%3B101&devices%5B%5D=101&send_to_email=&speed_limit=&stops=60&daily=0&weekly=0&monthly=0&skip_blank_results=0",
  "method": "POST"
}