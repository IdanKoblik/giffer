package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"time"
)

const (
	directory   = "./output"
)

type TelegramResponse struct {
	Ok          bool   `json:"ok"`
	Description string `json:"description"`
	Parameters  struct {
		RetryAfter int `json:"retry_after"`
	} `json:"parameters"`
}

func main() {
	files, _ := filepath.Glob(filepath.Join(directory, "*.webm"))
	sort.Strings(files)

	if len(files) == 0 {
		fmt.Println("No .webm files found.")
		return
	}

	// Split into chunks of 100
	for i := 0; i < len(files); i += 100 {
		end := i + 100
		if end > len(files) {
			end = len(files)
		}
		processChunk(i/100, files[i:end])
	}
}

func processChunk(chunkIdx int, chunk []string) {
	packName := fmt.Sprintf("gif_pack_%d_%s_by_%s", chunkIdx, userID, botUsername)
	title := fmt.Sprintf("Go GIF Pack Part %d", chunkIdx+1)

	fmt.Printf("--- Creating Pack: %s ---\n", title)

	for idx, file := range chunk {
		var url string
		var payload map[string]string

		if idx == 0 {
			url = fmt.Sprintf("https://api.telegram.org/bot%s/createNewStickerSet", token)
			stickerObj, _ := json.Marshal([]map[string]interface{}{
				{"sticker": "attach://sticker_file", "emoji_list": []string{"🔥"}, "format": "video"},
			})
			payload = map[string]string{
				"user_id":        userID,
				"name":           packName,
				"title":          title,
				"stickers":       string(stickerObj),
				"sticker_format": "video",
			}
		} else {
			url = fmt.Sprintf("https://api.telegram.org/bot%s/addStickerToSet", token)
			stickerObj, _ := json.Marshal(map[string]interface{}{
				"sticker": "attach://sticker_file", "emoji_list": []string{"🔥"}, "format": "video",
			})
			payload = map[string]string{
				"user_id":  userID,
				"name":     packName,
				"sticker":  string(stickerObj),
			}
		}

		sendRequestWithRetry(url, payload, file)
		fmt.Printf("[%d/%d] Added: %s\n", idx+1, len(chunk), filepath.Base(file))
	}
	fmt.Printf("Done! Pack Link: https://t.me/addstickers/%s\n", packName)
}

func sendRequestWithRetry(url string, params map[string]string, filePath string) {
	for {
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)

		for k, v := range params {
			_ = writer.WriteField(k, v)
		}

		file, _ := os.Open(filePath)
		part, _ := writer.CreateFormFile("sticker_file", filepath.Base(filePath))
		_, _ = io.Copy(part, file)
		file.Close()
		writer.Close()

		req, _ := http.NewRequest("POST", url, body)
		req.Header.Set("Content-Type", writer.FormDataContentType())

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			fmt.Printf("Network error: %v. Retrying in 5s...\n", err)
			time.Sleep(5 * time.Second)
			continue
		}

		var tgResp TelegramResponse
		json.NewDecoder(resp.Body).Decode(&tgResp)
		resp.Body.Close()

		if tgResp.Ok {
			return
		}

		if tgResp.Parameters.RetryAfter > 0 {
			wait := tgResp.Parameters.RetryAfter
			fmt.Printf("Rate limited! Sleeping for %d seconds...\n", wait)
			time.Sleep(time.Duration(wait) * time.Second)
			continue
		}

		fmt.Printf("Error from Telegram: %s\n", tgResp.Description)
		os.Exit(1)
	}
}
