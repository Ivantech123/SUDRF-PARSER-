package sudrf

import (
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"golang.org/x/net/html/charset"
	"golang.org/x/text/encoding/charmap"
)

const defaultUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

type FetchResult struct {
	Status int
	HTML   string
	URL    string
}

func CourtURL(subdomain, path string, preferHTTP bool) string {
	proto := "https"
	if preferHTTP {
		proto = "http"
	}
	return fmt.Sprintf("%s://%s.sudrf.ru%s", proto, subdomain, path)
}

func Fetch(subdomain, path string, preferHTTP bool, timeout time.Duration) (FetchResult, error) {
	urls := []string{CourtURL(subdomain, path, preferHTTP), CourtURL(subdomain, path, !preferHTTP)}
	var lastErr error
	for i, u := range urls {
		res, err := fetchOnce(u, timeout)
		if err == nil {
			return res, nil
		}
		lastErr = err
		if i == 0 && preferHTTP {
			continue
		}
		if i == 0 && !preferHTTP {
			continue
		}
	}
	return FetchResult{}, lastErr
}

func fetchOnce(url string, timeout time.Duration) (FetchResult, error) {
	client := &http.Client{Timeout: timeout}
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return FetchResult{}, err
	}
	req.Header.Set("User-Agent", defaultUA)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	req.Header.Set("Accept-Language", "ru-RU,ru;q=0.9,en;q=0.8")
	req.Header.Set("Accept-Encoding", "identity")

	resp, err := client.Do(req)
	if err != nil {
		return FetchResult{}, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return FetchResult{}, err
	}

	html, err := decodeHTML(body, resp.Header.Get("Content-Type"))
	if err != nil {
		return FetchResult{}, err
	}
	if err := detectAntibot(html); err != nil {
		return FetchResult{}, err
	}
	return FetchResult{Status: resp.StatusCode, HTML: html, URL: url}, nil
}

var errAntibot = fmt.Errorf("antibot block")

func decodeHTML(body []byte, contentType string) (string, error) {
	enc, _, _ := charset.DetermineEncoding(body, contentType)
	if enc == nil {
		head := string(body)
		if len(body) > 1024 {
			head = string(body[:1024])
		}
		if strings.Contains(strings.ToLower(head), "charset=windows-1251") {
			enc = charmap.Windows1251
		}
	}
	if enc != nil {
		out, err := enc.NewDecoder().Bytes(body)
		if err == nil {
			return string(out), nil
		}
	}
	return string(body), nil
}

func detectAntibot(html string) error {
	lower := strings.ToLower(html)
	if strings.Contains(lower, "qrator") || strings.Contains(lower, "qaptcha") ||
		strings.Contains(lower, "webknight") || strings.Contains(lower, "ddos-guard") {
		return errAntibot
	}
	return nil
}

func SchedulePath(date string) string {
	return "/modules.php?name=sud_delo&srv_num=1&H_date=" + date
}

var uidRe = regexp.MustCompile(`(?i)case_uid=([0-9a-f-]+)`)

func UIDFromLink(href string) string {
	m := uidRe.FindStringSubmatch(href)
	if len(m) > 1 {
		return m[1]
	}
	return ""
}
