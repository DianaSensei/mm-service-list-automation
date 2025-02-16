package org.example;

import com.opencsv.bean.CsvToBean;
import com.opencsv.bean.CsvToBeanBuilder;
import io.github.bonigarcia.wdm.WebDriverManager;
import org.openqa.selenium.By;
import org.openqa.selenium.Keys;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WindowType;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.openqa.selenium.interactions.Action;
import org.openqa.selenium.interactions.Actions;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.Select;
import org.openqa.selenium.support.ui.WebDriverWait;

import java.io.FileReader;
import java.time.Duration;
import java.util.List;

public class Main {
    public static void main(String[] args) throws InterruptedException {
//        if (args.length < 1) {
//            System.out.println("Error: Please provide a path to the CSV file");
//            return;
//        }

        var services = loadServices("src/data.csv");
        if (services == null || services.isEmpty()) {
            System.out.println("Error: No services found");
            return;
        }

        WebDriverManager.chromedriver().clearDriverCache();
        WebDriverManager.chromedriver().clearResolutionCache();
        WebDriverManager.chromedriver().setup();

        ChromeOptions options = new ChromeOptions();
        options.addArguments("user-data-dir=C:\\Users\\thefi\\AppData\\Local\\Google\\Chrome\\User Data");

        // Specify the profile directory, for example, use 'Default' or 'Profile 1'
        options.addArguments("profile-directory=Default");
//        options.setExperimentalOption("useAutomationExtension", false); // Disable automation extension
        options.setExperimentalOption("excludeSwitches", new String[]{"enable-automation"}); // Hide "Chrome is being controlled" message

        WebDriver driver = new ChromeDriver(options);
        driver.switchTo().newWindow(WindowType.TAB);

        System.out.println("Start loading web");
        driver.get("https://ga218935b806a36-dbn04er.adb.ap-singapore-1.oraclecloudapps.com/ords/r/momo_apex/service-list/d-service-list1?session=600701102466995");
        System.out.println("Load web complete");

        for (var service : services) {
            System.out.println("Start: " + service);

            WebDriverWait waitCreate = new WebDriverWait(driver, Duration.ofSeconds(10)); // 10 seconds wait
            var createButton = waitCreate.until(ExpectedConditions.visibilityOfElementLocated((By.id("B71233594014006408"))));
            createButton.click();

            driver.switchTo().frame(0); // Switch to the iframe

            var serviceCode = driver.findElement(By.id("P7_SERVICE_CODE_input"));
            var serviceDesc = driver.findElement(By.id("P7_SERVICE_DESCRIPTION_input"));
            var merchantName = driver.findElement(By.id("P7_MERCHANT_input"));
            var l1Select = new Select(driver.findElement(By.id("P7_BU_GROUP_CODE_L1_ID")));
            var l2Select = new Select(driver.findElement(By.id("P7_BU_GROUP_CODE_L2_ID")));
            var l4Select = new Select(driver.findElement(By.id("P7_BU_GROUP_CODE_L4_ID")));
            var l3Select = new Select(driver.findElement(By.id("P7_BU_GROUP_CODE_L3_ID")));
            var l5Select = new Select(driver.findElement(By.id("P7_BU_GROUP_CODE_L5_ID")));
            var l6Select = new Select(driver.findElement(By.id("P7_BU_GROUP_CODE_L6_ID")));

            var groupCodeL1Select = new Select(driver.findElement(By.id("P7_GROUP_CODE_L1_ID")));
            var verticalSelect = new Select(driver.findElement(By.id("P7_NEWVERTICAL_ID")));
            var projectSelect = new Select(driver.findElement(By.id("P7_SPECIALPROJECT_ID")));
            var checkbox = driver.findElement((By.id("P7_CHECK")));
            var submit = driver.findElement((By.id("B71221230860006389")));

            serviceCode.clear();
            serviceCode.sendKeys(service.getServiceCode());
            serviceDesc.clear();
            serviceDesc.sendKeys(service.getServiceDescription());
            merchantName.clear();
            merchantName.sendKeys(service.getMerchantName());

            l1Select.selectByVisibleText("SME OFFLINE");
            l2Select.selectByVisibleText(service.getL2());
            l3Select.selectByVisibleText(service.getL3());
            l4Select.selectByVisibleText(service.getL4());
            l5Select.selectByVisibleText("OTHER");
            l6Select.selectByVisibleText(service.getL6());
            groupCodeL1Select.selectByVisibleText("PAYMENT");

            if (service.getL3().equalsIgnoreCase("GROCERY")) {
                verticalSelect.selectByVisibleText("GROCERY - OTHER");
            } else {
                verticalSelect.selectByVisibleText(service.getL3());
            }

            projectSelect.selectByVisibleText("SME OFFLINE");

            if (!checkbox.isSelected()) {
                checkbox.click();
            }

            submit.click();

            driver.switchTo().defaultContent();
            try {
                WebDriverWait waitIframe = new WebDriverWait(driver, Duration.ofSeconds(10)); // 10 seconds wait
                waitIframe.until(ExpectedConditions.invisibilityOfElementLocated(By.cssSelector("iframe")));
            } catch (Exception e) {
                Actions esc = new Actions(driver);
                esc.sendKeys(Keys.ESCAPE).perform();
                System.out.println("Error occured " + e.getMessage());
            }

            System.out.println("End: " + service);
        }
    }

    private static List<Service> loadServices(String filePath) {
        try (var fileReader = new FileReader(filePath)) {
            CsvToBean<Service> csvToBean = new CsvToBeanBuilder<Service>(fileReader).withType(Service.class).build();
            return csvToBean.parse();
        } catch (Exception e) {
            System.out.println("Error: when load service " + e.getMessage());
            return null;
        }
    }
}