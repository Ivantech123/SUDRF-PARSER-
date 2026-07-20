package courts

import (
	"encoding/json"
	"os"
	"strings"
)

type Entry struct {
	Subdomain string `json:"subdomain"`
	Name      string `json:"name"`
	Region    string `json:"region"`
	Type      string `json:"type"`
	Vnkod     string `json:"vnkod"`
	Captcha   bool   `json:"captcha"`
	HTTP      bool   `json:"http"`
}

func Load(path string) ([]Entry, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var list []Entry
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil, err
	}
	return list, nil
}

func ByRegion(list []Entry, region string) []Entry {
	if region == "" {
		return list
	}
	out := make([]Entry, 0, len(list)/10)
	for _, c := range list {
		if c.Region == region {
			out = append(out, c)
		}
	}
	return out
}

func Score(c Entry) int {
	s := 0
	if c.HTTP && !c.Captcha {
		s += 100
	} else if c.HTTP {
		s += 40
	}
	switch c.Type {
	case "ray":
		s += 30
	case "vs", "oblsud":
		s += 15
	}
	if strings.HasSuffix(c.Subdomain, "kas") {
		s -= 80
	}
	return s
}

func SortByScore(list []Entry) {
	// simple insertion sort — lists are small per region
	for i := 1; i < len(list); i++ {
		j := i
		for j > 0 && Score(list[j]) > Score(list[j-1]) {
			list[j], list[j-1] = list[j-1], list[j]
			j--
		}
	}
}
