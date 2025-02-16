package org.example;

import com.opencsv.bean.CsvBindByPosition;

public class Service {

    public String getMid() {
        return mid;
    }

    public void setMid(String mid) {
        this.mid = mid;
    }

    public String getServiceCode() {
        return serviceCode;
    }

    public void setServiceCode(String serviceCode) {
        this.serviceCode = serviceCode;
    }

    public String getServiceDescription() {
        return serviceDescription;
    }

    public void setServiceDescription(String serviceDescription) {
        this.serviceDescription = serviceDescription;
    }

    public String getMerchantName() {
        return merchantName;
    }

    public void setMerchantName(String merchantName) {
        this.merchantName = merchantName;
    }

    public String getL2() {
        return l2;
    }

    public void setL2(String l2) {
        this.l2 = l2;
    }

    public String getL3() {
        return l3;
    }

    public void setL3(String l3) {
        this.l3 = l3;
    }

    public String getL4() {
        return l4;
    }

    public void setL4(String l4) {
        this.l4 = l4;
    }

    public String getL6() {
        return l6;
    }

    public void setL6(String l6) {
        this.l6 = l6;
    }

    @CsvBindByPosition(position = 0)
    private String mid;

    @CsvBindByPosition(position = 1)
    private String serviceCode;

    @CsvBindByPosition(position = 2)
    private String serviceDescription;

    @CsvBindByPosition(position = 3)
    private String merchantName;

    @CsvBindByPosition(position = 6)
    private String l2;

    @CsvBindByPosition(position = 7)
    private String l3;

    @CsvBindByPosition(position = 8)
    private String l4;

    @CsvBindByPosition(position = 9)
    private String l6;

    @Override
    public String toString() {
        return String.format("Service: mid %s, serviceCode %s, serviceDescription %s, merchantName %s, l2 %s, l3 %s, l4 %s, l6 %s",
                mid, serviceCode, serviceDescription, merchantName, l2, l3, l4, l6);
    }
}
