public with sharing class CalendarViewController {

    /**
     * Processes an Image_URL__c value to return the appropriate thumbnail URL.
     * Mirrors the logic from the Image_Thumbnail__c formula field:
     * - Google Drive files: extract ID and use Drive thumbnail API
     * - Other URLs: return as-is
     */
    private static String processImageUrl(String imageUrl) {
        if (String.isBlank(imageUrl)) {
            return null;
        }

        if (imageUrl.contains('drive.google.com/file/d/')) {
            // Extract the file ID from the Google Drive URL
            Integer idStartIdx = imageUrl.indexOf('/d/') + 3;
            Integer idEndIdx   = imageUrl.indexOf('/', idStartIdx);
            if (idEndIdx == -1) {
                idEndIdx = imageUrl.length();
            }
            String fileId = imageUrl.substring(idStartIdx, idEndIdx);
            return 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w400';
        }

        // For non-Google Drive URLs, return as-is
        return imageUrl;
    }

    public class CalendarRecord {
        @AuraEnabled public String  id;
        @AuraEnabled public String  name;
        @AuraEnabled public String  status;
        @AuraEnabled public String  dateValue;       // 'YYYY-MM-DD'
        @AuraEnabled public String  objectType;      // 'Article' | 'SocialMediaPost'
        @AuraEnabled public String  objectLabel;
        // Articles__c: which date field is driving placement
        @AuraEnabled public String  dateFieldLabel;
        // Articles__c: all date fields for hover display
        @AuraEnabled public String  briefDueDate;
        @AuraEnabled public String  writingDueDate;
        @AuraEnabled public String  publishingDate;
        // Social_Media_Post__c: extra hover fields
        @AuraEnabled public String  imageThumbnail;
        @AuraEnabled public String  caption;
        @AuraEnabled public String  hashtags;
        @AuraEnabled public Boolean clientApproved;
    }

    /**
     * Returns Articles__c and Social_Media_Post__c records whose
     * calendar-placement date falls within the given range (inclusive),
     * scoped to a specific Marketing_Engagement__c parent record.
     *
     * Articles appear on ALL filled date fields:
     *   - Publishing_Date__c
     *   - Writing_Due_Date__c
     *   - Brief_Due_Date__c
     */
    @AuraEnabled(cacheable=true)
    public static List<CalendarRecord> getRecords(String startDate, String endDate, String marketingEngagementId) {
        List<CalendarRecord> records = new List<CalendarRecord>();
        Date dtStart = Date.valueOf(startDate);
        Date dtEnd   = Date.valueOf(endDate);
        Id   meId    = (Id) marketingEngagementId;

        // ── Articles__c ───────────────────────────────────────────────────
        // Show each article on every filled date field within the range
        for (Articles__c a : [
            SELECT Id, Name, Stage__c,
                   Brief_Due_Date__c, Writing_Due_Date__c, Publishing_Date__c
            FROM   Articles__c
            WHERE  Marketing_Engagement__c = :meId
            AND   ((Brief_Due_Date__c   >= :dtStart AND Brief_Due_Date__c   <= :dtEnd)
            OR     (Writing_Due_Date__c >= :dtStart AND Writing_Due_Date__c <= :dtEnd)
            OR     (Publishing_Date__c  >= :dtStart AND Publishing_Date__c  <= :dtEnd))
            WITH   SECURITY_ENFORCED
            LIMIT  500
        ]) {
            // Add record for each filled date field
            if (a.Publishing_Date__c != null && a.Publishing_Date__c >= dtStart && a.Publishing_Date__c <= dtEnd) {
                CalendarRecord r = new CalendarRecord();
                r.id              = a.Id;
                r.name            = a.Name;
                r.status          = a.Stage__c;
                r.dateValue       = String.valueOf(a.Publishing_Date__c);
                r.objectType      = 'Article';
                r.objectLabel     = 'Article';
                r.dateFieldLabel  = 'Publishing';
                r.briefDueDate    = a.Brief_Due_Date__c != null ? String.valueOf(a.Brief_Due_Date__c) : null;
                r.writingDueDate  = a.Writing_Due_Date__c != null ? String.valueOf(a.Writing_Due_Date__c) : null;
                r.publishingDate  = a.Publishing_Date__c != null ? String.valueOf(a.Publishing_Date__c) : null;
                records.add(r);
            }

            if (a.Writing_Due_Date__c != null && a.Writing_Due_Date__c >= dtStart && a.Writing_Due_Date__c <= dtEnd) {
                CalendarRecord r = new CalendarRecord();
                r.id              = a.Id;
                r.name            = a.Name;
                r.status          = a.Stage__c;
                r.dateValue       = String.valueOf(a.Writing_Due_Date__c);
                r.objectType      = 'Article';
                r.objectLabel     = 'Article';
                r.dateFieldLabel  = 'Writing Due';
                r.briefDueDate    = a.Brief_Due_Date__c != null ? String.valueOf(a.Brief_Due_Date__c) : null;
                r.writingDueDate  = a.Writing_Due_Date__c != null ? String.valueOf(a.Writing_Due_Date__c) : null;
                r.publishingDate  = a.Publishing_Date__c != null ? String.valueOf(a.Publishing_Date__c) : null;
                records.add(r);
            }

            if (a.Brief_Due_Date__c != null && a.Brief_Due_Date__c >= dtStart && a.Brief_Due_Date__c <= dtEnd) {
                CalendarRecord r = new CalendarRecord();
                r.id              = a.Id;
                r.name            = a.Name;
                r.status          = a.Stage__c;
                r.dateValue       = String.valueOf(a.Brief_Due_Date__c);
                r.objectType      = 'Article';
                r.objectLabel     = 'Article';
                r.dateFieldLabel  = 'Brief Due';
                r.briefDueDate    = a.Brief_Due_Date__c != null ? String.valueOf(a.Brief_Due_Date__c) : null;
                r.writingDueDate  = a.Writing_Due_Date__c != null ? String.valueOf(a.Writing_Due_Date__c) : null;
                r.publishingDate  = a.Publishing_Date__c != null ? String.valueOf(a.Publishing_Date__c) : null;
                records.add(r);
            }
        }

        // ── Social_Media_Post__c ──────────────────────────────────────────
        for (Social_Media_Post__c p : [
            SELECT Id, Name, Post_Status__c, Post_Date__c,
                   Image_URL__c, Caption__c, Hashtags__c, Client_Approved__c
            FROM   Social_Media_Post__c
            WHERE  Marketing_Engagement__c = :meId
            AND    Post_Date__c >= :dtStart
            AND    Post_Date__c <= :dtEnd
            WITH   SECURITY_ENFORCED
            ORDER  BY Post_Date__c ASC
            LIMIT  500
        ]) {
            if (p.Post_Date__c == null) continue;

            CalendarRecord r = new CalendarRecord();
            r.id             = p.Id;
            r.name           = p.Name;
            r.status         = p.Post_Status__c;
            r.dateValue      = String.valueOf(p.Post_Date__c);
            r.objectType     = 'SocialMediaPost';
            r.objectLabel    = 'Social Post';
            r.imageThumbnail = processImageUrl(p.Image_URL__c);
            r.caption        = p.Caption__c;
            r.hashtags       = p.Hashtags__c;
            r.clientApproved = p.Client_Approved__c;
            records.add(r);
        }

        return records;
    }
}