package sudrf

import (
	"regexp"
	"strings"

	"github.com/PuerkitoBio/goquery"
)

type HearingItem struct {
	CaseNumber  string
	CaseUID     string
	Parties     string
	Category    string
	Judge       string
	Courtroom   string
	HearingTime string
	HearingDate string
	CaseURL     string
}

type ScheduleResult struct {
	Court   string
	Date    string
	Items   []HearingItem
	Status  string
	Warning string
}

func ParseHearingSchedule(html, courtName, date string) ScheduleResult {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		return ScheduleResult{Court: courtName, Date: date, Status: "parse_error", Warning: err.Error()}
	}

	if regexp.MustCompile(`(?i)qrator|qaptcha|webknight|ddos-guard`).MatchString(html) {
		return ScheduleResult{
			Court: courtName, Date: date, Status: "antibot",
			Warning: "Страница расписания заблокирована антиботом",
		}
	}

	bodyText := clean(doc.Find("body").Text())
	if regexp.MustCompile(`(?i)дело не назначено|заседания не назначены|на указанную дату заседаний нет`).MatchString(bodyText) {
		return ScheduleResult{Court: courtName, Date: date, Status: "empty_docket"}
	}

	table := doc.Find("#tablcont").First()
	if table.Length() == 0 {
		doc.Find("table").EachWithBreak(func(_ int, s *goquery.Selection) bool {
			if regexp.MustCompile(`(?i)номер дела|время слушания`).MatchString(clean(s.Find("tr").First().Text())) {
				table = s
				return false
			}
			return true
		})
	}
	if table.Length() == 0 {
		return ScheduleResult{
			Court: courtName, Date: date, Status: "no_table",
			Warning: "Таблица расписания не найдена",
		}
	}

	headers := []string{}
	table.Find("tr").First().Find("td,th").Each(func(_ int, c *goquery.Selection) {
		headers = append(headers, strings.ToLower(clean(c.Text())))
	})
	col := func(name string) int {
		for i, h := range headers {
			if strings.Contains(h, name) {
				return i
			}
		}
		return -1
	}
	iNum := col("номер дела")
	if iNum < 0 {
		iNum = 1
	}
	iTime := col("время слушания")
	if iTime < 0 {
		iTime = col("время")
	}
	iRoom := col("зал")
	if iRoom < 0 {
		iRoom = col("место")
	}
	iInfo := col("информация по делу")
	if iInfo < 0 {
		iInfo = col("информация")
	}
	iJudge := col("судья")

	var items []HearingItem
	table.Find("tr").Slice(1, goquery.ToEnd).Each(func(_ int, tr *goquery.Selection) {
		if tr.Find("td[colspan]").Length() > 0 && tr.Find("a[href*='case_id']").Length() == 0 {
			return
		}
		cells := tr.Find("td")
		if cells.Length() < 4 {
			return
		}
		numCell := cells.Eq(iNum)
		num := clean(numCell.Text())
		if num == "" || regexp.MustCompile(`(?i)дел не назначено`).MatchString(num) {
			return
		}
		link, _ := numCell.Find("a").Attr("href")
		var infoLines []string
		if iInfo >= 0 && iInfo < cells.Length() {
			infoLines = brLines(cells.Eq(iInfo))
		}
		get := func(i int) string {
			if i >= 0 && i < cells.Length() {
				return clean(cells.Eq(i).Text())
			}
			return ""
		}
		items = append(items, HearingItem{
			CaseNumber:  num,
			CaseUID:     UIDFromLink(link),
			Parties:     partiesFromLines(infoLines),
			Category:    lineValue(infoLines, "КАТЕГОРИЯ"),
			Judge:       get(iJudge),
			Courtroom:   get(iRoom),
			HearingTime: get(iTime),
			HearingDate: date,
			CaseURL:     link,
		})
	})

	status := "empty_docket"
	if len(items) > 0 {
		status = "ok"
	}
	return ScheduleResult{Court: courtName, Date: date, Items: items, Status: status}
}

func clean(s string) string {
	s = strings.ReplaceAll(s, "\u00a0", " ")
	re := regexp.MustCompile(`\s+`)
	return strings.TrimSpace(re.ReplaceAllString(s, " "))
}

func brLines(cell *goquery.Selection) []string {
	html, _ := cell.Html()
	html = regexp.MustCompile(`(?i)<br\s*/?>`).ReplaceAllString(html, "\n")
	doc, _ := goquery.NewDocumentFromReader(strings.NewReader("<div>" + html + "</div>"))
	text := doc.Find("div").Text()
	var out []string
	for _, line := range strings.Split(text, "\n") {
		if t := clean(line); t != "" {
			out = append(out, t)
		}
	}
	return out
}

func lineValue(lines []string, labels ...string) string {
	for _, line := range lines {
		for _, label := range labels {
			re := regexp.MustCompile(`(?i)^` + regexp.QuoteMeta(label) + `\s*(?:\([^)]*\))?\s*[:\)]\s*(.*)$`)
			if m := re.FindStringSubmatch(line); len(m) > 1 && clean(m[1]) != "" {
				return clean(m[1])
			}
		}
	}
	return ""
}

func partiesFromLines(lines []string) string {
	plaintiff := lineValue(lines, "ИСТЕЦ", "ЗАЯВИТЕЛЬ")
	defendant := lineValue(lines, "ОТВЕТЧИК")
	if plaintiff != "" && defendant != "" {
		return plaintiff + " — " + defendant
	}
	if plaintiff != "" {
		return plaintiff
	}
	return defendant
}
